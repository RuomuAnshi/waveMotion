#!/usr/bin/env tsx
/**
 * 验收：引擎层确定性（严格断言，0 容差）。
 *
 * 这一层才是「任意帧跳转 / 预览与成片同帧」的真正保证：所有动画都必须是
 * 「当前帧 + 分析数据 + 固定种子」的纯函数。它与 GPU 光栅化无关，所以可以
 * 要求逐字段完全相等。
 *
 * 与 acceptance-determinism.mjs 的分工：
 *   - 这里：动画逻辑确定性（严格，0 差异）
 *   - 那里：像素输出确定性（有容差，因为 GPU 光栅化存在 ±4/255 级抖动）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildScene, SceneEngine, type Scene } from "../src/engine/frame.ts";
import { buildBeatTimeline } from "../src/engine/beat.ts";
import { ROOT, analyzeFile, sampleAudioPath, createChecker } from "./lib/env.mjs";

const checker = createChecker();

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "wm-engine-"));
const analysis = analyzeFile(sampleAudioPath(), path.join(OUT, "analysis.json"));
analysis.audioId = "wav";

const visual = {
  template: "particleField",
  palette: "crimsonPurple",
  customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
  intensity: 0.5, sensitivity: 1, backgroundBrightness: 0.5, autoVariation: true, seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: {},
};
const output = { width: 1920, height: 1080, fps: 30 };
const totalFrames = Math.ceil(analysis.durationSec * output.fps);

const NUM_FIELDS = [
  "rms", "low", "mid", "high", "onset", "energy", "silenceGate", "motion",
  "pulse", "onsetPulse", "sectionProgress", "sectionSwing", "bar4Progress",
] as const;

function snapshot(engine: SceneEngine, frame: number) {
  const s: Scene = engine.scene(analysis, frame, output.fps, output.width, output.height);
  const nums: Record<string, number> = {};
  for (const k of NUM_FIELDS) nums[k] = s[k] as number;
  return {
    nums,
    spectrum: s.spectrum.slice(),
    palette: s.palette,
    beat: {
      index: s.beat.index, pulse: s.beat.pulse, strength: s.beat.strength,
      beatCount: s.beat.beatCount, bar4: s.beat.bar4, bar8: s.beat.bar8,
    },
    sectionIndex: s.sectionIndex,
    bar4: s.bar4,
    seed: s.seed,
    unit: s.unit,
  };
}

// 1) 两个独立引擎实例遍历全部帧：逐字段必须完全相同
{
  const e1 = new SceneEngine(visual as never);
  const e2 = new SceneEngine(visual as never);
  let diffs = 0;
  let worst = 0;
  for (let f = 0; f < totalFrames; f++) {
    const a = snapshot(e1, f);
    const b = snapshot(e2, f);
    for (const k of NUM_FIELDS) {
      const d = Math.abs(a.nums[k] - b.nums[k]);
      if (d > worst) worst = d;
      if (d !== 0) diffs++;
    }
    for (let i = 0; i < a.spectrum.length; i++) {
      const d = Math.abs(a.spectrum[i] - b.spectrum[i]);
      if (d > worst) worst = d;
      if (d !== 0) diffs++;
    }
    if (JSON.stringify(a.palette) !== JSON.stringify(b.palette)) diffs++;
    if (JSON.stringify(a.beat) !== JSON.stringify(b.beat)) diffs++;
    if (a.sectionIndex !== b.sectionIndex || a.bar4 !== b.bar4 || a.seed !== b.seed || a.unit !== b.unit) diffs++;
  }
  checker.check(
    `两个独立引擎实例遍历 ${totalFrames} 帧，逐字段完全一致`,
    diffs === 0 && worst === 0,
    `差异 ${diffs} 处，最大数值差 ${worst}`,
  );
}

// 2) 跳帧渲染 == 顺序渲染：打乱顺序访问同一批帧，结果必须与顺序访问相同
{
  const engine = new SceneEngine(visual as never);
  const order = Array.from({ length: totalFrames }, (_, i) => i);
  const sequential = order.map((f) => JSON.stringify(snapshot(engine, f)));

  // 用固定种子打乱，避免每次运行顺序不同
  const shuffled = [...order];
  let s = 12345;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const e2 = new SceneEngine(visual as never);
  const random = new Map(shuffled.map((f) => [f, JSON.stringify(snapshot(e2, f))]));
  const bad = order.filter((f) => sequential[f] !== random.get(f));
  checker.check(
    `打乱帧序访问，${totalFrames} 帧结果与顺序访问完全一致`,
    bad.length === 0,
    bad.length ? `不一致帧 ${bad.slice(0, 5).join(",")}` : "",
  );
}

// 3) buildScene 纯函数：同输入多次调用完全相同（不经引擎缓存）
{
  const timeline = buildBeatTimeline(analysis, visual.rhythm as never);
  const prep = new SceneEngine(visual as never).prepare(analysis).prep;
  const input = { analysis: prep, timeline, visual: visual as never, frame: 137, fps: 30, width: 1920, height: 1080 };
  const a = JSON.stringify(buildScene(input));
  const b = JSON.stringify(buildScene(input));
  assertPure(a, b);
  function assertPure(x: string, y: string) {
    checker.check("buildScene 纯函数：同输入两次调用结果完全相同", x === y, x === y ? "" : "存在字段差异");
  }
}

// 4) 拍点时间线确定：同输入两次构建完全一致
{
  const a = JSON.stringify(buildBeatTimeline(analysis, visual.rhythm as never));
  const b = JSON.stringify(buildBeatTimeline(analysis, visual.rhythm as never));
  checker.check("拍点时间线构建确定", a === b);
}

console.log(`\n分析：${analysis.durationSec.toFixed(3)}s / ${totalFrames} 帧 / BPM ${analysis.bpm}`);
checker.summary();
