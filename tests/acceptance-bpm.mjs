#!/usr/bin/env node
/**
 * 验收：合成节拍音频的 BPM / 起拍检测精度。
 * 生成若干已知 BPM、已知起拍偏移的 click 音频，跑 python/analyze.py，
 * 比对检测 BPM 误差（目标 ≤1%）与首拍位置误差。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, resolvePython } from "./lib/env.mjs";

const PY = resolvePython();
const OUT = path.join(os.tmpdir(), "wm-accept");
fs.mkdirSync(OUT, { recursive: true });

/** 用 numpy 直接写 wav，避免依赖 ffmpeg 的合成精度 */
function makeClickWav({ bpm, offsetSec, durationSec, sr = 44100 }) {
  const script = `
import numpy as np, soundfile as sf, sys
bpm = ${bpm}; offset = ${offsetSec}; dur = ${durationSec}; sr = ${sr}
n = int(round(dur * sr))
y = np.zeros(n, dtype=np.float32)
interval = 60.0 / bpm
t = offset
k = 0
rng = np.random.default_rng(7)
while t < dur - 0.01:
    i = int(round(t * sr))
    L = min(int(0.09 * sr), n - i)
    if L > 0:
        env = np.exp(-np.arange(L) / (0.012 * sr))
        click = np.sin(2 * np.pi * 1000 * np.arange(L) / sr) * env * 0.85
        acc = np.sin(2 * np.pi * 220 * np.arange(L) / sr) * env * 0.35 * (1.0 if k % 4 == 0 else 0.0)
        y[i:i+L] += (click + acc).astype(np.float32)
    t += interval
    k += 1
y += rng.normal(0, 0.0015, n).astype(np.float32)
np.clip(y, -1, 1, out=y)
sf.write(sys.argv[1], np.stack([y, y], axis=1), sr, subtype='PCM_16')
`;
  const file = path.join(OUT, `click-${bpm}-${offsetSec}.wav`);
  execFileSync(PY, ["-c", script, file], { stdio: "pipe", cwd: ROOT });
  return file;
}

const cases = [
  { bpm: 120, offsetSec: 0.0, durationSec: 12 },
  { bpm: 128, offsetSec: 0.25, durationSec: 12 },
  { bpm: 90, offsetSec: 0.5, durationSec: 12 },
  { bpm: 140, offsetSec: 0.1, durationSec: 12 },
  { bpm: 100, offsetSec: 1.2, durationSec: 12 },
];

const rows = [];
let worstBpm = 0;
let worstOffset = 0;
for (const c of cases) {
  const file = makeClickWav(c);
  const anFile = path.join(OUT, `an-${c.bpm}-${c.offsetSec}.json`);
  execFileSync(PY, [path.join(ROOT, "python/analyze.py"), "--input", file, "--output", anFile], { stdio: "pipe" });
  const an = JSON.parse(fs.readFileSync(anFile, "utf8"));
  const bpmErr = Math.abs(an.bpm - c.bpm) / c.bpm;
  // 检测到的拍点中，找与理论拍点最接近的一个，误差即起拍对齐误差
  const interval = 60 / c.bpm;
  const firstBeat = an.beatsSec.length ? an.beatsSec[0] : NaN;
  const expectFirst = c.offsetSec;
  // 允许整体相位差（可能首拍被漏检），取最小残差
  let bestResidual = Infinity;
  for (const b of an.beatsSec) {
    const k = Math.round((b - expectFirst) / interval);
    const residual = Math.abs(b - (expectFirst + k * interval));
    if (residual < bestResidual) bestResidual = residual;
  }
  worstBpm = Math.max(worstBpm, bpmErr);
  worstOffset = Math.max(worstOffset, bestResidual);
  rows.push({
    bpm: c.bpm,
    offset: c.offsetSec,
    detectedBpm: +an.bpm.toFixed(3),
    bpmErrPct: +(bpmErr * 100).toFixed(3),
    firstBeat: isNaN(firstBeat) ? null : +firstBeat.toFixed(4),
    beatResidualMs: +(bestResidual * 1000).toFixed(2),
    beats: an.beatsSec.length,
    stability: +an.rhythm.stability.toFixed(3),
    needsCorrection: an.rhythm.needsCorrection,
  });
}

console.log("BPM 检测精度：");
console.table(rows);
console.log(`\n最大 BPM 误差: ${(worstBpm * 100).toFixed(3)}%  (目标 ≤1%)`);
console.log(`最大拍点残差: ${(worstOffset * 1000).toFixed(2)} ms`);
const pass = worstBpm <= 0.01;
console.log(pass ? "✅ BPM 精度验收通过" : "❌ BPM 精度验收未通过");
process.exit(pass ? 0 : 1);
