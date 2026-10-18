#!/usr/bin/env node
/**
 * 验收：整片画面完整性。
 *
 * 这是 GL 后端选型的把关测试。某些 GPU 光栅化路径（macOS 无头 Chrome 的 egl、
 * angle-egl）会静默丢掉大部分画面，只留下顶部若干水平条带：
 *   - 单帧尺寸仍是 1920x1080
 *   - ffprobe 的分辨率/帧率/帧数/时长全部正常
 *   - ffmpeg 解码也不报错
 * 需要逐帧检查单侧缺失的水平行。历史扫描实测 egl 在 513 帧整片里有 77 帧损坏，
 * angle-egl 51~72 帧，而 angle 两次都是 0 帧。
 *
 * 因此这里必须渲染【整片】，不能用 renderStill 或短片段代替：短段和单帧
 * 都测不出问题（早期用 renderStill 选后端就是这样误判的）。
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolveChrome, sampleAudioPath, createChecker } from "./lib/env.mjs";

const chrome = resolveChrome();
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "wm-integrity-"));
const checker = createChecker();

// 与生产导出保持一致的后端；可用 WM_GL 覆盖以复现坏后端
const gl = process.env.WM_GL || "angle";
// 候选阈值：大面积黑色后继续检查单侧缺失的水平行。
// 黑底圆盘和纯黑尾帧不能仅凭黑色面积判坏。
const BLACK_RATIO_LIMIT = 0.10;
// 允许的损坏帧数（0 表示必须完全干净）
const MAX_CORRUPT = Number(process.env.WM_MAX_CORRUPT ?? 0);

const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
analysis.audioId = "wav";

const template = process.argv[2] || "particleField";
const fps = 30;
const totalFrames = Math.ceil(analysis.durationSec * fps);
const visual = {
  template,
  palette: "crimsonPurple",
  customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
  intensity: 0.5, sensitivity: 1, backgroundBrightness: 0.5, autoVariation: true, seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: {},
};
const inputProps = { analysis, visual, output: { width: 1920, height: 1080, fps, totalFrames } };

console.log(`模板 ${template} / GL=${gl} / 分辨率 1920x1080 / 帧数 ${totalFrames}`);
console.log(`整片渲染中（这是必要代价：单帧或短段测不出丢条带）…`);

const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/remotion/root.tsx") });
const composition = await selectComposition({ serveUrl, id: "WaveMotion", browserExecutable: chrome, inputProps });
const mp4 = path.join(OUT, "full.mp4");
const started = Date.now();
await renderMedia({
  composition, serveUrl, browserExecutable: chrome, outputLocation: mp4,
  codec: "h264",
  pixelFormat: "yuv420p", colorSpace: "bt709", imageFormat: "png", crf: 18,
  muted: true, chromiumOptions: { gl }, inputProps,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`整片渲染完成：${elapsed}s`);

// 直接复用服务端导出时的同一个扫描器，保证验收与线上兜底口径一致
const { scanFrameIntegrity } = await import("../server/lib/ffmpeg.ts");
const scan = await scanFrameIntegrity(mp4, { blackRatioLimit: BLACK_RATIO_LIMIT });

console.log(`扫描结果：${scan.frames} 帧，损坏 ${scan.corrupt.length} 帧，` +
  `最大纯黑占比 ${scan.maxBlackRatio}，中位数 ${scan.medianBlackRatio}`);
if (scan.corrupt.length > 0) {
  console.log(`  损坏帧号（前 20）：${scan.corrupt.slice(0, 20).join(", ")}`);
}

checker.check("整片帧数与分析时长一致", scan.frames === totalFrames, `${scan.frames} vs ${totalFrames}`);
checker.check(`损坏帧数不超过 ${MAX_CORRUPT}`, scan.corrupt.length <= MAX_CORRUPT, `${scan.corrupt.length} 帧`);
checker.check("没有单侧缺失的水平条带", scan.maxMissingRowRatio <= 0.08, String(scan.maxMissingRowRatio));

if (scan.corrupt.length > 0) {
  console.log("\n提示：这是 GPU 光栅化丢条带，不是编码问题。");
  console.log("      ffprobe 的尺寸/帧率/帧数/时长都会显示「正常」，只有逐帧像素扫描能发现。");
  console.log("      生产默认已是 WAVEMOTION_GL=angle（最完整）；仍出现损坏说明当前机器\n"
    + "      GPU 光栅化不稳定，可尝试降低渲染并发后重试，或换一台机器导出。");
}

checker.summary();
