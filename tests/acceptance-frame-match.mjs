#!/usr/bin/env node
/**
 * 验收：预览（Player / renderStill）与成片（renderMedia）在同一帧完全一致。
 *
 * 做法：
 *  1. 用 renderStill 单独渲染目标帧 -> still.png（等价于预览所用的 Composition）
 *  2. 用 renderMedia 渲染同一 Composition 的短区间成片 -> clip.mp4
 *  3. 用 ffmpeg 抽出该帧 -> from-mp4.png
 *  4. 逐像素比较（记录 PSNR / 最大绝对差）
 *
 * 若两者相差极小（仅编码损耗），说明预览与成片同源、无随机抖动。
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill, renderMedia } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolveChrome, sampleAudioPath } from "./lib/env.mjs";

const chrome = resolveChrome();
// 每次运行用独立目录，避免并发运行时互相覆盖中间产物
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "wm-framematch-"));

const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
analysis.audioId = "wav";

const template = process.argv[2] || "particleField";
const targetFrame = Number(process.argv[3] || 137);
const fps = 30;
const totalFrames = Math.ceil(analysis.durationSec * fps);

const visual = {
  template,
  palette: "crimsonPurple",
  customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
  intensity: 0.5,
  sensitivity: 1,
  backgroundBrightness: 0.5,
  autoVariation: true,
  seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: {},
};

const inputProps = {
  analysis,
  visual,
  output: { width: 1920, height: 1080, fps, totalFrames },
};

// 与生产导出保持一致的 GL 后端（renderService 用 egl：逐像素确定且最快）
const gl = process.env.WM_GL || "egl";
console.log(`bundle... (template=${template}, frame=${targetFrame}, gl=${gl})`);
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/remotion/root.tsx") });
const composition = await selectComposition({
  serveUrl,
  id: "WaveMotion",
  browserExecutable: chrome,
  inputProps,
});

// 1) 静帧
const stillPath = path.join(OUT, "still.png");
await renderStill({
  composition,
  serveUrl,
  browserExecutable: chrome,
  output: stillPath,
  frame: targetFrame,
  inputProps,
  chromiumOptions: { gl },
});

// 2) 只渲染目标帧附近的短区间成片
const clipPath = path.join(OUT, "clip.mp4");
const from = targetFrame;
const to = targetFrame + 1;
await renderMedia({
  composition,
  serveUrl,
  browserExecutable: chrome,
  outputLocation: clipPath,
  codec: "h264",
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
  imageFormat: "png",
  crf: 18,
  muted: true,
  audioCodec: null,
  chromiumOptions: { gl },
  frameRange: [from, to],
  inputProps,
});

// 3) 抽帧
const mp4Frame = path.join(OUT, "from-mp4.png");
execFileSync("/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", clipPath, "-vf", "select=eq(n\\,0)", "-vsync", "0", "-frames:v", "1", mp4Frame], { stdio: "pipe" });

// 4) 比较
const pyScript = `
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB"), dtype=np.float64)
if a.shape != b.shape:
    print("SIZE_MISMATCH", a.shape, b.shape); sys.exit(2)
diff = np.abs(a - b)
mse = float(np.mean((a - b) ** 2))
psnr = float("inf") if mse == 0 else 10 * np.log10(255.0 ** 2 / mse)
print(f"max_abs_diff={diff.max():.2f}")
print(f"mean_abs_diff={diff.mean():.4f}")
print(f"psnr={psnr:.2f}")
print(f"pixels_over_2={int((diff.max(axis=2) > 2).sum())}")
print(f"total_pixels={a.shape[0]*a.shape[1]}")
`;
const pyOut = execFileSync(".venv/bin/python", ["-c", pyScript, stillPath, mp4Frame], { encoding: "utf8" });
console.log(pyOut.trim());

const psnr = Number(/psnr=([\d.]+)/.exec(pyOut)?.[1] ?? 0);
const pass = psnr >= 40;
console.log(pass ? "✅ 预览与成片同帧一致（PSNR ≥ 40 dB，仅编码损耗）" : "❌ 预览与成片存在明显差异");
process.exit(pass ? 0 : 1);
