#!/usr/bin/env node
/**
 * 验收：预览（renderStill）与成片（renderMedia）在同一次渲染里产出同一帧。
 *
 * 判定方式（不假设偏移，直接测出来）：
 *  1. renderStill 渲染目标帧 F  -> still.png
 *  2. renderMedia 渲染区间 [F-2, F+2] -> clip.mp4（5 帧）
 *  3. 抽出全部 5 帧，与 still.png 逐帧比对 PSNR
 *  4. 要求「最匹配的一帧」正好落在区间内的第 2 个位置（即帧 F），
 *     且 PSNR ≥ 40 dB。若最匹配位置不是 F，说明成片帧序错位——这是真 bug，
 *     会明确报出来；若位置对但 PSNR 低，说明画面本身不一致。
 *
 * 这样既验证了「同帧一致」，也顺带验证了「帧序对齐」。
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill, renderMedia } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolveChrome, sampleAudioPath } from "./lib/env.mjs";

const chrome = resolveChrome();
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

const inputProps = { analysis, visual, output: { width: 1920, height: 1080, fps, totalFrames } };

const gl = process.env.WM_GL || "angle";
const FROM = Math.max(0, targetFrame - 2);
const TO = Math.min(totalFrames - 1, targetFrame + 2);
const expectedIndex = targetFrame - FROM;

console.log(`bundle... (template=${template}, frame=${targetFrame}, range=[${FROM},${TO}], gl=${gl})`);
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/remotion/root.tsx") });
const composition = await selectComposition({
  serveUrl,
  id: "WaveMotion",
  browserExecutable: chrome,
  inputProps,
});

// 1) 静帧（等价于预览所用的 Composition 在同一帧的画面）
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

// 2) 同一 Composition 的短区间成片
const clipPath = path.join(OUT, "clip.mp4");
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
  frameRange: [FROM, TO],
  inputProps,
});

// 3) 抽出区间内全部帧
const framesDir = path.join(OUT, "frames");
fs.mkdirSync(framesDir, { recursive: true });
execFileSync(
  "/opt/homebrew/bin/ffmpeg",
  ["-y", "-loglevel", "error", "-i", clipPath, "-vf", "format=rgb24", "-f", "image2", path.join(framesDir, "m-%02d.png")],
  { stdio: "pipe" },
);
const extracted = fs.readdirSync(framesDir).filter((f) => /^m-\d+\.png$/.test(f)).sort();
if (extracted.length !== TO - FROM + 1) {
  console.error(`❌ 成片帧数不符：期望 ${TO - FROM + 1} 帧，实际 ${extracted.length} 帧`);
  process.exit(1);
}

// 4) 与静帧逐帧比对
const pyScript = `
import sys, json, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64)
res = []
for i, p in enumerate(sys.argv[2:]):
    b = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
    if a.shape != b.shape:
        res.append({"idx": i, "psnr": -1, "max": 999, "note": "size_mismatch"})
        continue
    d = np.abs(a - b)
    mse = float((d ** 2).mean())
    psnr = 99.99 if mse == 0 else float(10 * np.log10(255.0 ** 2 / mse))
    res.append({"idx": i, "psnr": round(psnr, 2), "max": float(d.max())})
print(json.dumps(res))
`;
const rows = JSON.parse(
  execFileSync(
    ".venv/bin/python",
    ["-c", pyScript, stillPath, ...extracted.map((f) => path.join(framesDir, f))],
    { encoding: "utf8" },
  ).trim(),
);

console.log(`静帧 frame ${targetFrame} vs 成片 5 帧（期望最匹配位置 = ${expectedIndex}）:`);
rows.forEach((r) => {
  const pos = FROM + r.idx;
  const mark = r.idx === expectedIndex ? " ← 期望" : "";
  console.log(`  成片第 ${r.idx} 帧 (frame ${pos}): psnr=${r.psnr.toFixed(2)}dB max=${r.max}${mark}`);
});

const best = rows.reduce((a, b) => (b.psnr > a.psnr ? b : a), rows[0]);
const bestPos = FROM + best.idx;
const alignmentOk = best.idx === expectedIndex;
const qualityOk = best.psnr >= 40;

console.log("");
if (!alignmentOk) {
  console.log(`❌ 帧序错位：最匹配的是成片第 ${best.idx} 帧 (frame ${bestPos})，期望第 ${expectedIndex} 帧 (frame ${targetFrame})`);
} else if (!qualityOk) {
  console.log(`❌ 预览与成片存在明显差异：PSNR ${best.psnr.toFixed(2)} dB < 40 dB`);
} else {
  console.log(`✅ 预览与成片同帧一致（frame ${targetFrame} → 成片第 ${best.idx} 帧，PSNR ${best.psnr.toFixed(2)} dB ≥ 40 dB，仅编码损耗）`);
}
process.exit(alignmentOk && qualityOk ? 0 : 1);
