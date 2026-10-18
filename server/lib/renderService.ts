import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, ensureBrowser, makeCancelSignal } from "@remotion/renderer";
import type { RenderJob, AudioAnalysis } from "../../src/shared/types.ts";
import { RENDERS_DIR, ensureDir, uniqueFileName } from "./paths.ts";
import { verifyRender, runFfmpeg } from "./ffmpeg.ts";
import { TMP_DIR } from "./paths.ts";
import { ROOT_DIR } from "./paths.ts";

const ENTRY_POINT = path.join(ROOT_DIR, "src/remotion/root.tsx");

/**
 * 渲染用 OpenGL 后端。
 *
 * 默认 egl：实测（macOS + 系统 Chrome）同帧重复渲染 12 轮逐像素完全一致，
 * 且比默认的 angle 更快（1920x1080 30 帧 5.9s vs 7.6s）。angle 走 Metal 时
 * 会偶发 ±4/255 的 GPU 光栅分块抖动，导致同一帧两次导出结果不同。
 * 其他平台可通过 WAVEMOTION_GL 覆盖；若 egl 不可用可退回 angle-egl。
 */
const DEFAULT_GL = "egl";
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

  const { cancel, cancelSignal } = makeCancelSignal();
  onCancel(() => cancel());

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
