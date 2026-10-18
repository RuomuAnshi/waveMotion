#!/usr/bin/env node
/**
 * 验收：边界条件。
 *  - 半速 / 双速：视觉拍点数量应为 1x 的一半 / 两倍
 *  - 手动 BPM + 起拍偏移：视觉触发时刻与「BPM + 偏移」一致（误差 ≤1 帧）
 *  - 开头静音 / 无稳定节拍 / 损坏音频 / 极低音量
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, analyzeFile, resolvePython, sampleAudioPath } from "./lib/env.mjs";

const PY = resolvePython();
const OUT = path.join(os.tmpdir(), "wm-edge");
fs.mkdirSync(OUT, { recursive: true });

let pass = true;
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push([name, ok, detail]);
  if (!ok) pass = false;
};

// ---------- 1) 半速 / 双速：用引擎的 buildBeatTimeline 直接验证 ----------
const { buildBeatTimeline } = await import("../src/engine/beat.ts");
const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
const autoTl = buildBeatTimeline(analysis, { mode: "auto", bpm: null, offsetSec: 0, rate: 1 });
check("自动模式使用检测拍点", autoTl.times.length === analysis.beatsSec.length && autoTl.source === "auto",
  `${autoTl.times.length} vs ${analysis.beatsSec.length}`);

const halfTl = buildBeatTimeline(analysis, { mode: "auto", bpm: null, offsetSec: 0, rate: 0.5 });
const doubleTl = buildBeatTimeline(analysis, { mode: "auto", bpm: null, offsetSec: 0, rate: 2 });
check("半速拍点约为 1x 的一半", Math.abs(halfTl.times.length - Math.ceil(autoTl.times.length / 2)) <= 1,
  `${halfTl.times.length} vs ${autoTl.times.length}`);
check("双速拍点约为 1x 的两倍", Math.abs(doubleTl.times.length - (autoTl.times.length * 2 - 1)) <= 2,
  `${doubleTl.times.length} vs ${autoTl.times.length}`);

// ---------- 2) 手动 BPM + 偏移：触发误差 ≤ 1 帧 ----------
const manualBpm = 129.2;
const manualOffset = 0.137;
const manualTl = buildBeatTimeline(analysis, { mode: "manual", bpm: manualBpm, offsetSec: manualOffset, rate: 1 });
const interval = 60 / manualBpm;
let worstFrames = 0;
for (let k = 0; k < manualTl.times.length; k++) {
  const expect = manualOffset + k * interval;
  if (expect > analysis.durationSec) break;
  const got = manualTl.times[k];
  const errFrames = Math.abs(got - expect) * analysis.frameRate;
  worstFrames = Math.max(worstFrames, errFrames);
}
check("手动 BPM+偏移 触发误差 ≤1 帧", worstFrames <= 1.0, `最大 ${worstFrames.toFixed(4)} 帧`);

// ---------- 3) 边界音频 ----------
function synth(name, opts) {
  const file = path.join(OUT, `${name}.wav`);
  const code = `
import numpy as np, soundfile as sf, sys
name, kind = sys.argv[1], sys.argv[2]
sr = 44100
dur = 8.0
n = int(dur*sr)
rng = np.random.default_rng(11)
sr_ = sr
if kind == "silent_intro":
    y = np.zeros(n, dtype=np.float32)
    t0 = 2.5
    for k in range(12):
        i = int((t0 + k*0.5)*sr_)
        L = min(int(0.08*sr_), n-i)
        if L > 0 and i >= 0:
            env = np.exp(-np.arange(L)/(0.012*sr_))
            y[i:i+L] += (np.sin(2*np.pi*900*np.arange(L)/sr_)*env*0.8).astype(np.float32)
elif kind == "quiet":
    y = rng.normal(0, 0.004, n).astype(np.float32)
    for k in range(16):
        i = int(k*0.5*sr_)
        L = min(int(0.06*sr_), n-i)
        if L > 0:
            env = np.exp(-np.arange(L)/(0.01*sr_))
            y[i:i+L] += (np.sin(2*np.pi*700*np.arange(L)/sr_)*env*0.05).astype(np.float32)
elif kind == "no_beat":
    y = rng.normal(0, 0.08, n).astype(np.float32)
    x = np.linspace(0, 40*np.pi, n)
    y = (np.sin(x + np.sin(x*3.3)*4)*0.05 + rng.normal(0, 0.05, n)).astype(np.float32)
else:
    y = np.zeros(n, dtype=np.float32)
np.clip(y, -1, 1, out=y)
sf.write(sys.argv[3], np.stack([y, y], axis=1), sr_, subtype='PCM_16')
`;
  execFileSync(PY, ["-c", code, name, opts.kind, file], { stdio: "pipe" });
  return file;
}

for (const [name, kind, expectWarn] of [
  ["silent-intro", "silent_intro", true],
  ["quiet", "quiet", true],
  ["no-beat", "no_beat", true],
  ["silence", "silence", true],
]) {
  const file = synth(name, { kind });
  const anFile = path.join(OUT, `${name}.json`);
  try {
    execFileSync(PY, [path.join(ROOT, "python/analyze.py"), "--input", file, "--output", anFile], { stdio: "pipe" });
    const an = JSON.parse(fs.readFileSync(anFile, "utf8"));
    const hasWarn = Array.isArray(an.warnings) && an.warnings.length > 0;
    const needsCorrection = an.rhythm?.needsCorrection;
    check(`边界音频 ${name} 可分析且给出提示`, expectWarn ? hasWarn || needsCorrection : true,
      `warnings=${an.warnings?.length ?? 0} needsCorrection=${needsCorrection} bpm=${an.bpm} beats=${an.beatsSec.length}`);
  } catch (e) {
    check(`边界音频 ${name} 可分析`, false, String(e.stderr ?? e).slice(0, 200));
  }
}

// 损坏音频：应给出可读错误，而不是崩溃
const bad = path.join(OUT, "corrupt.wav");
fs.writeFileSync(bad, Buffer.from("not a real wav file at all", "utf8"));
let badOk = false;
let badMsg = "";
try {
  execFileSync(PY, [path.join(ROOT, "python/analyze.py"), "--input", bad, "--output", path.join(OUT, "corrupt.json")], { stdio: "pipe" });
} catch (e) {
  badOk = true;
  badMsg = String(e.stderr ?? "").trim().split("\n").slice(-1)[0].slice(0, 160);
}
check("损坏音频返回可读错误", badOk, badMsg);

console.log("验收：边界条件与节奏控制");
for (const [name, ok, detail] of checks) console.log(`${ok ? "✅" : "❌"} ${name}  ${detail}`);
console.log(pass ? "\n✅ 边界条件验收通过" : "\n❌ 边界条件验收存在失败项");
process.exit(pass ? 0 : 1);
