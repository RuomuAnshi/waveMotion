#!/usr/bin/env node
/**
 * 验收：确定性渲染。
 * particleField 含大量解析式随机，是确定性风险最高的模板。
 * 同帧渲染两次（两个独立 bundle），逐像素比较；再测「直接跳帧」与
 * 「从头播放到该帧」是否一致（即任意帧跳转不依赖预计算路径）。
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolveChrome, sampleAudioPath } from "./lib/env.mjs";

const chrome = resolveChrome();
// 每次运行用独立目录，避免并发运行时互相覆盖中间产物
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "wm-determinism-"));

const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
analysis.audioId = "wav";

const template = process.argv[2] || "particleField";
const fps = 30;
const totalFrames = Math.ceil(analysis.durationSec * fps);
const frames = (process.argv[3] || "24,137,301").split(",").map(Number);

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

// 与生产导出保持一致的 GL 后端（renderService 用 egl：逐像素确定且最快）
const gl = process.env.WM_GL || "egl";

const pyScript = `
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB"), dtype=np.float64)
d = np.abs(a - b)
print(f"max={d.max():.2f} mean={d.mean():.4f} nonzero={int((d>0).sum())}")
`;

const rows = [];
for (const f of frames) {
  const p1 = path.join(OUT, `pass1-${f}.png`);
  const p2 = path.join(OUT, `pass2-${f}.png`);
  await renderStill({ composition, serveUrl, browserExecutable: chrome, output: p1, frame: f, inputProps, chromiumOptions: { gl } });
  await renderStill({ composition, serveUrl, browserExecutable: chrome, output: p2, frame: f, inputProps, chromiumOptions: { gl } });
  const cmp = execFileSync(".venv/bin/python", ["-c", pyScript, p1, p2], { encoding: "utf8" }).trim();
  const identical = /max=0\.00 mean=0\.0000/.test(cmp);
  rows.push({ frame: f, result: cmp, identical });
  console.log(`frame ${f}: ${cmp} ${identical ? "✅ 完全一致" : "❌ 存在差异"}`);
}

// 第二组：从第 0 帧开始连续渲染若干帧，与直接渲染该帧比较
// （验证 Composition 不依赖播放历史）
const seqPath = path.join(OUT, "seq");
fs.mkdirSync(seqPath, { recursive: true });
const target = frames[frames.length - 1];
for (let f = Math.max(0, target - 3); f <= target; f++) {
  await renderStill({
    composition, serveUrl, browserExecutable: chrome,
    output: path.join(seqPath, `f-${f}.png`), frame: f, inputProps, chromiumOptions: { gl },
  });
}
const directPath = path.join(OUT, `pass1-${target}.png`);
const seqCmp = execFileSync(
  ".venv/bin/python",
  ["-c", pyScript, directPath, path.join(seqPath, `f-${target}.png`)],
  { encoding: "utf8" },
).trim();
const seqIdentical = /max=0\.00 mean=0\.0000/.test(seqCmp);
console.log(`跳帧 vs 顺序播放 (frame ${target}): ${seqCmp} ${seqIdentical ? "✅ 一致" : "❌ 不一致"}`);

const allPass = rows.every((r) => r.identical) && seqIdentical;
console.log(allPass ? "\n✅ 确定性渲染验收通过（重复渲染逐像素一致，任意帧跳转结果一致）" : "\n❌ 确定性渲染验收未通过");
process.exit(allPass ? 0 : 1);
