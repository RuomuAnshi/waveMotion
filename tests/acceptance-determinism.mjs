#!/usr/bin/env node
/**
 * 验收：像素输出确定性（重复渲染 / 跳帧渲染）。
 *
 * 判定分两层，因为「完全相同」和「视觉相同」是两件事：
 *
 * 1) 严格层：动画逻辑必须是「当前帧 + 分析数据 + 固定种子」的纯函数，
 *    逐字段 0 差异 —— 由 tests/acceptance-engine.ts 以 0 容差断言
 *    （遍历 513 帧、打乱帧序访问，完全不经过 GPU）。
 *
 * 2) 本文件（像素层）：Chromium 的 GPU 分块光栅化在同一台机器上存在
 *    间歇性竞态，同一帧两次渲染偶尔会有 ±4/255 级差异（实测：多数
 *    采样 0 差异，偶发 1.3M 像素差 4 级，呈水平条带）。这属于光栅化
 *    噪声，不是动画逻辑问题，因此用「视觉等价」阈值判定：
 *      - max diff ≤ 8/255（远低于肉眼可辨，且覆盖实测最差 4~15 级里的
 *        稳定区间；超过则说明构图真的变了）
 *      - PSNR ≥ 45 dB
 *      - 且必须同时通过 acceptance-engine 的严格层
 *
 * 注意：不希望出现「为了过测试而放宽」，所以这里同时输出原始数字，
 * 便于人工复核。历史上尝试过的替代方案（egl/swangle/swiftshader/
 * vulkan/--disable-gpu-rasterization/--disable-partial-raster/
 * --num-raster-threads=1）要么整片丢条带，要么仍然抖动，不可用；
 * 详见 README「渲染确定性」一节。
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolveChrome, sampleAudioPath } from "./lib/env.mjs";

const chrome = resolveChrome();
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "wm-determinism-"));

const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
analysis.audioId = "wav";

const template = process.argv[2] || "particleField";
const fps = 30;
const totalFrames = Math.ceil(analysis.durationSec * fps);
const frames = (process.argv[3] || "24,137,301").split(",").map(Number);

// 视觉等价阈值（依据实测噪声上界设定，见文件头注释）
const MAX_DIFF = 8;
const MIN_PSNR = 45;

const visual = {
  template,
  palette: "crimsonPurple",
  customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
  intensity: 0.5, sensitivity: 1, backgroundBrightness: 0.5, autoVariation: true, seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: {},
};
const inputProps = { analysis, visual, output: { width: 1920, height: 1080, fps, totalFrames } };

const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/remotion/root.tsx") });
const composition = await selectComposition({ serveUrl, id: "WaveMotion", browserExecutable: chrome, inputProps });

// 与生产导出一致的 GL 后端（renderService 默认 angle）
const gl = process.env.WM_GL || "angle";

const pyScript = `
import sys, json, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB"), dtype=np.float64)
d = np.abs(a - b)
mse = float((d ** 2).mean())
psnr = 99.99 if mse == 0 else float(10 * np.log10(255.0 ** 2 / mse))
print(json.dumps({
    "max": float(d.max()), "mean": round(float(d.mean()), 5),
    "psnr": round(psnr, 2), "nonzero": int((d > 0).sum()),
    "px_gt8": int((d > 8).sum()), "total": int(d.size),
}))
`;

function compare(p1, p2) {
  const raw = execFileSync(".venv/bin/python", ["-c", pyScript, p1, p2], { encoding: "utf8" }).trim();
  const r = JSON.parse(raw);
  r.identical = r.max === 0;
  r.acceptable = r.max <= MAX_DIFF && r.psnr >= MIN_PSNR;
  return r;
}

function fmt(r) {
  return `max=${r.max.toFixed(2)} psnr=${r.psnr.toFixed(2)}dB mean=${r.mean.toFixed(4)}` +
    ` nonzero=${r.nonzero} px>8=${r.px_gt8}`;
}

const rows = [];
for (const f of frames) {
  const p1 = path.join(OUT, `pass1-${f}.png`);
  const p2 = path.join(OUT, `pass2-${f}.png`);
  await renderStill({ composition, serveUrl, browserExecutable: chrome, output: p1, frame: f, inputProps, chromiumOptions: { gl } });
  await renderStill({ composition, serveUrl, browserExecutable: chrome, output: p2, frame: f, inputProps, chromiumOptions: { gl } });
  const r = compare(p1, p2);
  rows.push({ frame: f, ...r });
  const verdict = r.identical ? "✅ 逐像素完全一致" : r.acceptable ? "✅ 视觉等价（光栅化噪声内）" : "❌ 超出容差";
  console.log(`frame ${f}: ${fmt(r)} ${verdict}`);
}

// 第二组：直接跳帧 vs 从邻近帧顺序渲染（验证 Composition 不依赖播放历史）
const seqPath = path.join(OUT, "seq");
fs.mkdirSync(seqPath, { recursive: true });
const target = frames[frames.length - 1];
for (let f = Math.max(0, target - 3); f <= target; f++) {
  await renderStill({
    composition, serveUrl, browserExecutable: chrome,
    output: path.join(seqPath, `f-${f}.png`), frame: f, inputProps, chromiumOptions: { gl },
  });
}
const seqR = compare(path.join(OUT, `pass1-${target}.png`), path.join(seqPath, `f-${target}.png`));
const seqVerdict = seqR.identical ? "✅ 逐像素一致" : seqR.acceptable ? "✅ 视觉等价" : "❌ 不一致";
console.log(`跳帧 vs 顺序播放 (frame ${target}): ${fmt(seqR)} ${seqVerdict}`);

const repeatPass = rows.every((r) => r.acceptable);
const allPass = repeatPass && seqR.acceptable;
const exact = rows.every((r) => r.identical) && seqR.identical;
console.log(
  allPass
    ? `\n✅ 像素输出确定性验收通过（重复渲染与跳帧渲染均在视觉等价容差内：max≤${MAX_DIFF}, PSNR≥${MIN_PSNR}dB）` +
      (exact ? "；本次全部逐像素完全一致" : "")
    : "\n❌ 像素输出确定性验收未通过",
);
process.exit(allPass ? 0 : 1);
