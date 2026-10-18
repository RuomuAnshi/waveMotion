import type { AudioAnalysis } from "../shared/types.ts";
import { clamp, lerp } from "./random.ts";

/** 线性插值采样时间序列（frameRate 采样） */
export function sampleSeries(values: number[], frameRate: number, timeSec: number): number {
  if (!values.length) return 0;
  if (frameRate <= 0) return values[0] ?? 0;
  const pos = timeSec * frameRate;
  const i = Math.floor(pos);
  if (i < 0) return values[0] ?? 0;
  if (i >= values.length - 1) return values[values.length - 1] ?? 0;
  const u = pos - i;
  return lerp(values[i], values[i + 1], u);
}

/** 采样 32 个频谱频段到传入数组（避免每帧分配） */
export function sampleSpectrum(
  analysis: AudioAnalysis,
  timeSec: number,
  out: number[],
  gain = 1,
): number[] {
  const bands = analysis.spectrumBands;
  const fps = analysis.frameRate;
  const pos = timeSec * fps;
  const frames = Math.max(1, Math.floor(analysis.spectrumFlat.length / Math.max(1, bands)));
  let i = Math.floor(pos);
  let u = pos - i;
  if (i < 0) {
    i = 0;
    u = 0;
  }
  if (i >= frames - 1) {
    i = frames - 1;
    u = 0;
  }
  const next = Math.min(frames - 1, i + 1);
  for (let b = 0; b < bands; b++) {
    const a = analysis.spectrumFlat[i * bands + b] ?? 0;
    const c = analysis.spectrumFlat[next * bands + b] ?? 0;
    out[b] = clamp(lerp(a, c, u) * gain);
  }
  return out;
}

/** 非对称平滑：快速响应、平滑回落。与帧无关，便于任意帧跳转。 */
export function smoothSeries(
  values: number[],
  frameRate: number,
  attackSec: number,
  releaseSec: number,
): number[] {
  const n = values.length;
  if (!n) return [];
  const atk = 1 - Math.exp(-1 / Math.max(1e-6, attackSec * frameRate));
  const rel = 1 - Math.exp(-1 / Math.max(1e-6, releaseSec * frameRate));
  const out = new Array<number>(n);
  let y = values[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const x = values[i] ?? 0;
    const k = x > y ? atk : rel;
    y = y + (x - y) * k;
    out[i] = y;
  }
  return out;
}

/** 频谱平滑（按频段，先响应后回落） */
export function smoothSpectrum(
  analysis: AudioAnalysis,
  attackSec: number,
  releaseSec: number,
): Float32Array {
  const bands = analysis.spectrumBands;
  const frames = Math.floor(analysis.spectrumFlat.length / Math.max(1, bands));
  const out = new Float32Array(frames * bands);
  const fps = analysis.frameRate;
  const atk = 1 - Math.exp(-1 / Math.max(1e-6, attackSec * fps));
  const rel = 1 - Math.exp(-1 / Math.max(1e-6, releaseSec * fps));
  const y = new Float32Array(bands);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bands; b++) {
      const x = analysis.spectrumFlat[f * bands + b] ?? 0;
      const k = x > y[b] ? atk : rel;
      y[b] = y[b] + (x - y[b]) * k;
      out[f * bands + b] = y[b];
    }
  }
  return out;
}

/** 从平滑频谱数组采样到 out */
export function sampleSmoothedSpectrum(
  smoothed: Float32Array,
  bands: number,
  frameRate: number,
  timeSec: number,
  out: number[],
): number[] {
  const frames = Math.max(1, Math.floor(smoothed.length / Math.max(1, bands)));
  const pos = timeSec * frameRate;
  let i = Math.floor(pos);
  let u = pos - i;
  if (i < 0) {
    i = 0;
    u = 0;
  }
  if (i >= frames - 1) {
    i = frames - 1;
    u = 0;
  }
  const next = Math.min(frames - 1, i + 1);
  for (let b = 0; b < bands; b++) {
    const a = smoothed[i * bands + b] ?? 0;
    const c = smoothed[next * bands + b] ?? 0;
    out[b] = lerp(a, c, u);
  }
  return out;
}

export interface PreparedAnalysis {
  analysis: AudioAnalysis;
  /** 平滑后的响度（快速起、慢回落） */
  rms: number[];
  low: number[];
  mid: number[];
  high: number[];
  onset: number[];
  spectrum: Float32Array;
}

/** 预先平滑所有包络，后续按帧直接采样（确定性、无状态） */
export function prepareAnalysis(analysis: AudioAnalysis): PreparedAnalysis {
  const fps = analysis.frameRate || 60;
  return {
    analysis,
    rms: smoothSeries(analysis.rms, fps, 0.02, 0.28),
    low: smoothSeries(analysis.low, fps, 0.015, 0.24),
    mid: smoothSeries(analysis.mid, fps, 0.02, 0.2),
    high: smoothSeries(analysis.high, fps, 0.012, 0.16),
    onset: smoothSeries(analysis.onsetStrength, fps, 0.008, 0.16),
    spectrum: smoothSpectrum(analysis, 0.012, 0.18),
  };
}
