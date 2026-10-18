import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, ensureBrowser, makeCancelSignal } from "@remotion/renderer";
import type { RenderJob, AudioAnalysis } from "../../src/shared/types.ts";
import { RENDERS_DIR, ensureDir, uniqueFileName } from "./paths.ts";
import { verifyRender, runFfmpeg, scanFrameIntegrity } from "./ffmpeg.ts";
import { TMP_DIR } from "./paths.ts";
import { ROOT_DIR } from "./paths.ts";

const ENTRY_POINT = path.join(ROOT_DIR, "src/remotion/root.tsx");

/**
 * 渲染用 OpenGL 后端。
 *
 * 默认 angle：这是唯一能稳定产出「整片画面完整」成片的后端。实测（macOS +
 * 系统 Chrome，1920x1080x513 帧整片，每后端连渲两次）：angle 两次均 0/513
 * 帧损坏；egl 77/513、angle-egl 51~72/513 帧损坏——表现为单帧尺寸正常但
 * 只画出了顶部若干条水平条带、其余纯黑（Remotion issue #11428 GPU 光栅化
 * 失败），且 ffprobe 元数据与帧数完全正常，只有逐帧像素扫描才能发现。
 *
 * 注意：egl 在「单帧 renderStill 重复渲染」上确实逐像素一致（12/12 轮 0
 * 差异），但那只测单帧、测不出整片丢条带。单帧确定性 ≠ 视频帧完整性。
 * angle 的跨次差异只是 H.264 编码决策（PSNR 54dB / max 13 灰阶），可接受。
 *
 * 其他平台可通过 WAVEMOTION_GL 覆盖。
 */
const DEFAULT_GL = "angle";
const VALID_GL = ["swangle", "angle", "egl", "swiftshader", "vulkan", "angle-egl"] as const;

export type GlRenderer = NonNullable<Parameters<typeof renderMedia>[0]["chromiumOptions"]>["gl"];

export function resolveGlRenderer(): GlRenderer {
  const override = process.env.WAVEMOTION_GL?.trim();
  if (override && (VALID_GL as readonly string[]).includes(override)) return override as GlRenderer;
  return DEFAULT_GL;
}

/** 系统 Chrome 路径候选（macOS / Linux / Windows） */
const CHROME_CANDIDATES = [
  process.env.WAVEMOTION_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export function resolveBrowser(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** serveUrl 缓存：源码或配置变更时重新打包 */
let cachedBundle: { url: string; key: string } | null = null;

function sourceKey(): string {
  // 用关键目录的 mtime 总和判断是否需要重新打包
  const dirs = ["src/remotion", "src/templates", "src/engine", "src/shared"];
  let sum = 0;
  for (const dir of dirs) {
    const abs = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      const stat = fs.statSync(path.join(abs, entry));
      if (stat.isFile()) sum += stat.mtimeMs;
    }
  }
  return String(sum);
}

export async function getServeUrl(onProgress?: (p: number) => void): Promise<string> {
  if (process.env.WAVEMOTION_REMOTION_BUNDLE) return process.env.WAVEMOTION_REMOTION_BUNDLE;
  const key = sourceKey();
  if (cachedBundle && cachedBundle.key === key) return cachedBundle.url;
  const url = await bundle({
    entryPoint: ENTRY_POINT,
    onProgress: (p) => onProgress?.(p * 0.15),
  });
  cachedBundle = { url, key };
  return url;
}

export interface RenderExecutionOptions {
  analysis: AudioAnalysis;
  job: RenderJob;
  onProgress: (progress: number) => void;
  onCancel: (fn: () => void) => void;
  isCancelled: () => boolean;
}

/** 执行一次导出：渲染视频帧 + 合成音轨（如需要），返回输出文件信息 */
export async function executeRender(opts: RenderExecutionOptions): Promise<RenderJob["output"]> {
  const { job, analysis, onProgress, onCancel, isCancelled } = opts;
  const snapshot = job.snapshot;
  const spec = snapshot;
  const { cancel, cancelSignal } = makeCancelSignal();
  onCancel(() => cancel());
  const browserExecutable = resolveBrowser();
  if (!browserExecutable) {
    throw new Error("未找到 Chrome / Chromium。请安装 Google Chrome，或设置环境变量 WAVEMOTION_CHROME 指向浏览器可执行文件。");
  }

  ensureDir(RENDERS_DIR);
  const fileName = uniqueFileName("wavemotion", "mp4");
  const outputPath = path.join(RENDERS_DIR, fileName);

  const serveUrl = await getServeUrl();
  if (isCancelled()) return undefined;

  const inputProps = {
    analysis,
    visual: snapshot.visual,
    output: {
      width: snapshot.width,
      height: snapshot.height,
      fps: spec.output.fps,
      totalFrames: snapshot.totalFrames,
    },
  } as Record<string, unknown>;

  const composition = await selectComposition({
    serveUrl,
    id: "WaveMotion",
    inputProps,
    browserExecutable,
  });

  if (isCancelled()) return undefined;

  // 视频轨道单独渲染（不含音轨）。画面完全由分析数据驱动，
  // 音轨随后用 ffmpeg 从原音频直接封装，保证不重编码、时长精确。
  const videoOnlyPath = spec.includeAudio
    ? path.join(TMP_DIR, `${path.parse(fileName).name}-video.mp4`)
    : outputPath;
  ensureDir(TMP_DIR);

  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: "h264",
    outputLocation: videoOnlyPath,
    browserExecutable,
    binariesDirectory: process.env.WAVEMOTION_BINARIES_DIR || null,
    pixelFormat: "yuv420p",
    // 指定 bt709 才会输出有限范围 (tv) 的 yuv420p；默认会得到 yuvj420p (full range)
    colorSpace: "bt709",
    imageFormat: "png",
    crf: 18,
    muted: true,
    chromiumOptions: { gl: resolveGlRenderer() },
    concurrency: null,
    cancelSignal,
    onProgress: ({ progress }) => {
      onProgress(0.15 + progress * 0.82);
    },
  });

  if (isCancelled()) return undefined;
  if (!fs.existsSync(videoOnlyPath)) throw new Error("渲染结束但未生成输出文件");

  if (spec.includeAudio) {
    onProgress(0.975);
    // 音轨时长对齐到成片：音频略短时补静音，避免播放器在末尾提前结束
    const targetSec = snapshot.totalFrames / spec.output.fps;
    const mux = await runFfmpeg([
      "-y",
      "-i", videoOnlyPath,
      "-i", snapshot.audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-af", `apad=whole_dur=${targetSec.toFixed(4)}`,
      "-t", targetSec.toFixed(4),
      "-movflags", "+faststart",
      outputPath,
    ]);
    if (mux.code !== 0) {
      throw new Error(`封装音轨失败：${mux.stderr.trim().split("\n").slice(-1)[0] ?? "未知错误"}`);
    }
    fs.rmSync(videoOnlyPath, { force: true });
    if (isCancelled()) return undefined;
  }

  // 画面完整性兜底：某些 GPU 光栅化路径会静默丢条带（只画顶部若干水平行、
  // 其余纯黑），而分辨率/帧率/帧数/时长/解码全部正常，ffprobe 查不出来。
  // 扫描单侧缺失的水平行；大面积对称黑底（如渐变圆盘）本身不算损坏。
  if (process.env.WAVEMOTION_SKIP_INTEGRITY !== "1") {
    const integrity = await scanFrameIntegrity(outputPath);
    const corrupt = integrity.corrupt.length;
    const allowed = Math.floor(integrity.frames * 0.05);
    if (corrupt > allowed) {
      throw new Error(
        `成片画面不完整：${integrity.frames} 帧里有 ${corrupt} 帧只渲染出部分画面` +
          `（最大单侧缺失行占比 ${(integrity.maxMissingRowRatio * 100).toFixed(0)}%）。` +
          `这是 GPU 光栅化丢条带，不是编码问题。` +
          `请改用环境变量 WAVEMOTION_GL=angle 或降低渲染并发后重试。`,
      );
    }
  }

  const expectedDurationSec = snapshot.totalFrames / spec.output.fps;
  const verify = verifyRender(outputPath, {
    expectAudio: spec.includeAudio,
    expectNoAudio: !spec.includeAudio,
    expectedDurationSec,
    durationToleranceSec: 1 / spec.output.fps + 0.02,
  });
  if (!verify.ok) {
    // 规格不符视为失败，但保留文件供排查
    throw new Error(`成片校验未通过：${verify.problems.join("；")}`);
  }

  const stat = fs.statSync(outputPath);
  onProgress(1);
  return {
    fileName,
    path: outputPath,
    url: `/renders/${encodeURIComponent(fileName)}`,
    sizeBytes: stat.size,
  };
}

/** 启动时预热浏览器（可选，失败不阻塞服务启动） */
export async function warmUpBrowser(): Promise<void> {
  const browserExecutable = resolveBrowser();
  if (!browserExecutable) return;
  try {
    await ensureBrowser({ browserExecutable });
  } catch {
    // Chrome 已存在时通常无需下载；忽略
  }
}
