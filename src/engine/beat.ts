import type { AudioAnalysis, RhythmConfig } from "../shared/types.ts";
import { clamp, lerp } from "./random.ts";

export interface BeatTimeline {
  source: "auto" | "manual";
  /** 视觉拍点时间（秒），已应用 rate 与 offset */
  times: number[];
  /** 每次拍点的强度 0..1 */
  strengths: number[];
  /** 视觉拍点间隔（秒）均值 */
  intervalSec: number;
  bpm: number;
  rate: number;
  offsetSec: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 在 onset/beat 强度序列上按时间取窗口最大值的归一化强度 */
function strengthAt(analysis: AudioAnalysis, timeSec: number): number {
  const fps = analysis.frameRate;
  const idx = Math.round(timeSec * fps);
  const win = Math.max(1, Math.round(fps * 0.045));
  let best = 0;
  const onset = analysis.onsetStrength;
  for (let i = idx - win; i <= idx + win; i++) {
    if (i < 0 || i >= onset.length) continue;
    best = Math.max(best, onset[i]);
  }
  // 与响度混合，静音处强度自然降低
  const rms = analysis.rms[Math.min(analysis.rms.length - 1, Math.max(0, idx))] ?? 0;
  return clamp(Math.max(best, rms * 0.55));
}

/**
 * 构建视觉拍点时间轴。
 * - auto：直接使用检测到的拍点（不做匀速外推），rate 通过抽拍/补拍改变视觉节奏
 * - manual：使用 BPM + 起拍偏移生成规则拍点；能量与频谱仍用真实分析数据
 * - offset 只移动视觉拍点，不移动音频
 */
export function buildBeatTimeline(analysis: AudioAnalysis, rhythm: RhythmConfig): BeatTimeline {
  const rate = rhythm.rate;
  const offset = rhythm.offsetSec || 0;

  if (rhythm.mode === "manual" && rhythm.bpm && rhythm.bpm > 0) {
    const interval = 60 / (rhythm.bpm * rate);
    const first = offset;
    const times: number[] = [];
    const start = first - Math.ceil(first / interval) * interval;
    for (let t = start; t <= analysis.durationSec + interval; t += interval) {
      if (t >= -1e-6) times.push(Math.max(0, t));
    }
    times.sort((a, b) => a - b);
    const strengths = times.map((t) => strengthAt(analysis, t));
    return {
      source: "manual",
      times,
      strengths,
      intervalSec: interval,
      bpm: rhythm.bpm,
      rate,
      offsetSec: offset,
    };
  }

  // ---- 自动模式 ----
  const shiftedBeats = analysis.beatsSec.map((t, i) => ({
    time: t + offset,
    strength: analysis.beatStrengths?.[i] ?? analysis.rhythm.beatStrengths?.[i] ?? 0.8,
  })).filter(({ time }) => time >= 0 && time <= analysis.durationSec);
  const baseTimes = shiftedBeats.map(({ time }) => time);
  const baseStrengths = shiftedBeats.map(({ strength }) => strength);

  // 检测不可靠时退回 BPM 网格，避免画面完全没有拍点
  if (baseTimes.length < 2 && analysis.bpm > 0) {
    const interval = 60 / (analysis.bpm * rate);
    const times: number[] = [];
    for (let t = offset; t <= analysis.durationSec + interval; t += interval) {
      times.push(t);
    }
    return {
      source: "auto",
      times,
      strengths: times.map((t) => strengthAt(analysis, t)),
      intervalSec: interval,
      bpm: analysis.bpm,
      rate,
      offsetSec: offset,
    };
  }

  let times = baseTimes;
  let strengths = baseStrengths;

  if (rate === 0.5) {
    // 半速：每两拍取一拍
    const keepT: number[] = [];
    const keepS: number[] = [];
    for (let i = 0; i < times.length; i += 2) {
      keepT.push(times[i]);
      keepS.push(strengths[i]);
    }
    times = keepT;
    strengths = keepS;
  } else if (rate === 2) {
    // 双速：在两拍间插入中点（强度取两者均值）
    const fastT: number[] = [];
    const fastS: number[] = [];
    for (let i = 0; i < times.length; i++) {
      fastT.push(times[i]);
      fastS.push(strengths[i]);
      if (i < times.length - 1) {
        fastT.push((times[i] + times[i + 1]) / 2);
        fastS.push((strengths[i] + strengths[i + 1]) * 0.5);
      }
    }
    times = fastT;
    strengths = fastS;
  }

  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
  const interval = deltas.length ? median(deltas) : analysis.bpm > 0 ? 60 / analysis.bpm : 0.5;

  return {
    source: "auto",
    times,
    strengths,
    intervalSec: interval > 0 ? interval : 0.5,
    bpm: interval > 0 ? 60 / (interval * rate) : analysis.bpm,
    rate,
    offsetSec: offset,
  };
}

/** 二分查找 <= time 的最后一个索引，找不到返回 -1 */
export function lastIndexAtOrBefore(times: number[], timeSec: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= timeSec + 1e-9) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export interface BeatState {
  /** 当前拍点索引，-1 表示第一个拍点之前 */
  index: number;
  /** 距上一个拍点的时间（秒），无则为 Infinity */
  sinceSec: number;
  /** 拍点脉冲 0..1（快速响应、指数回落） */
  pulse: number;
  /** 当前拍点强度 0..1 */
  strength: number;
  /** 累计拍数（含已过去的拍点） */
  beatCount: number;
  /** 每 4 拍一个段落索引 */
  bar4: number;
  /** 每 8 拍一个段落索引 */
  bar8: number;
  /** 4 拍段落内的进度 0..1 */
  bar4Progress: number;
  /** 8 拍段落内的进度 0..1 */
  bar8Progress: number;
  /** 段落切换时的短转场进度 0..1，1 表示已完成 */
  sectionTransition: number;
}

export const BEAT_DECAY_SEC = 0.22;
export const ONSET_DECAY_SEC = 0.16;

/**
 * 计算某一时刻的节拍状态。纯函数：不依赖上一帧，支持任意帧跳转。
 */
export function beatStateAt(
  timeline: BeatTimeline,
  timeSec: number,
  decaySec = BEAT_DECAY_SEC,
  transitionSec = 0.6,
): BeatState {
  const times = timeline.times;
  const idx = lastIndexAtOrBefore(times, timeSec);

  if (idx < 0) {
    return {
      index: -1,
      sinceSec: Number.POSITIVE_INFINITY,
      pulse: 0,
      strength: 0.6,
      beatCount: 0,
      bar4: 0,
      bar8: 0,
      bar4Progress: 0,
      bar8Progress: 0,
      sectionTransition: 1,
    };
  }

  const since = timeSec - times[idx];
  const pulse = Math.exp(-Math.max(0, since) / Math.max(1e-4, decaySec));
  const beatCount = idx + 1;
  const interval = timeline.intervalSec || 0.5;

  // 段落进度：基于拍内时间，保证连续
  const within = clamp(since / interval);
  const bar4 = Math.floor(idx / 4);
  const bar8 = Math.floor(idx / 8);
  const beatInBar4 = idx % 4;
  const beatInBar8 = idx % 8;
  const bar4Progress = (beatInBar4 + within) / 4;
  const bar8Progress = (beatInBar8 + within) / 8;
  // 8 拍切换处，基于时间的短转场
  const sectionStart = times[Math.floor(idx / 8) * 8] ?? times[0];
  const sectionTransition = clamp((timeSec - sectionStart) / Math.max(1e-4, transitionSec));

  return {
    index: idx,
    sinceSec: since,
    pulse,
    strength: timeline.strengths[idx] ?? 0.8,
    beatCount,
    bar4,
    bar8,
    bar4Progress,
    bar8Progress,
    sectionTransition,
  };
}

/** 与拍点同步的分段连续值：每 4/8 拍平滑变化一次，用于构图变化 */
export function sectionValue(bar: number, bars: number, seedA: number, seedB: number): number {
  const t = bar / Math.max(1, bars);
  const a = (Math.sin((bar + seedA) * 1.7) + 1) * 0.5;
  const b = (Math.sin((bar + seedB) * 2.3 + t) + 1) * 0.5;
  return a * 0.6 + b * 0.4;
}

/** 最近起音事件（用于粒子爆发）：返回 (0,1] 的脉冲 */
export function onsetPulseAt(
  onsetsSec: number[],
  timeSec: number,
  decaySec = ONSET_DECAY_SEC,
): { pulse: number; sinceSec: number } {
  const idx = lastIndexAtOrBefore(onsetsSec, timeSec);
  if (idx < 0) return { pulse: 0, sinceSec: Number.POSITIVE_INFINITY };
  const since = timeSec - onsetsSec[idx];
  return { pulse: Math.exp(-Math.max(0, since) / Math.max(1e-4, decaySec)), sinceSec: since };
}
