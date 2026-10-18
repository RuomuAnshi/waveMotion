import type { ColorSet, TemplateParamValue, VisualConfig } from "../shared/types.ts";
import { resolveColors } from "../shared/constants.ts";
import { clamp, lerp, mixColor, smoothstep } from "./random.ts";
import {
  prepareAnalysis,
  sampleSeries,
  sampleSmoothedSpectrum,
  type PreparedAnalysis,
} from "./analysis.ts";
import {
  beatStateAt,
  buildBeatTimeline,
  onsetPulseAt,
  type BeatState,
  type BeatTimeline,
} from "./beat.ts";

/** 模板可能读取的动态数值参数 */
export type ParamReader = {
  num(key: string, fallback: number): number;
  bool(key: string, fallback: boolean): boolean;
};

export interface Scene {
  frame: number;
  time: number;
  fps: number;
  width: number;
  height: number;
  /** 短边长度，便于按比例布局 */
  unit: number;

  visual: VisualConfig;
  colors: ColorSet;
  /** 段落间过渡后的实际主色/辅色（autoVariation 生效时会在色板内漂移） */
  palette: { background: string; primary: string; secondary: string; accent: string };
  intensity: number;
  sensitivity: number;

  analysis: PreparedAnalysis;
  timeline: BeatTimeline;
  beat: BeatState;

  /** 采样后的包络（已乘 sensitivity 并截断到 0..1） */
  rms: number;
  low: number;
  mid: number;
  high: number;
  onset: number;
  /** 综合能量 0..1 */
  energy: number;
  /** 频谱 32 段（已乘 sensitivity） */
  spectrum: number[];
  /** 静音门限：静音段趋近 0 */
  silenceGate: number;
  /** 运动强度 = intensity * silenceGate，模板统一用它缩放动作 */
  motion: number;
  /** 拍点脉冲（已乘强度与 intensity） */
  pulse: number;
  /** 起音脉冲（0..1，衰减更快） */
  onsetPulse: number;
  /** 每 8 拍的段落索引 */
  sectionIndex: number;
  /** 段落内进度 0..1 */
  sectionProgress: number;
  /** 段落交替摆动 -1..1，用于构图变化 */
  sectionSwing: number;
  /** 4 拍段落索引与进度 */
  bar4: number;
  bar4Progress: number;
  /** 固定随机种子 */
  seed: number;
  /** 模板参数读取器 */
  param: ParamReader;
}

export interface SceneInput {
  analysis: PreparedAnalysis;
  timeline: BeatTimeline;
  visual: VisualConfig;
  frame: number;
  fps: number;
  width: number;
  height: number;
}

/** 由帧号计算完整场景。纯函数（同一输入永远同一输出），支持任意帧跳转。 */
export function buildScene(input: SceneInput, spectrumOut?: number[]): Scene {
  const { analysis, timeline, visual, frame, fps, width, height } = input;
  const prep = analysis;
  const fpsA = prep.analysis.frameRate || 60;
  const time = frame / fps;
  const duration = prep.analysis.durationSec;

  const beat = beatStateAt(timeline, time);
  const sens = clamp(visual.sensitivity, 0.2, 3);
  const gain = (v: number) => clamp(v * sens);

  // 采样包络（平滑序列）
  const rmsRaw = sampleSeries(prep.rms, fpsA, time);
  const rms = gain(rmsRaw);
  const low = gain(sampleSeries(prep.low, fpsA, time));
  const mid = gain(sampleSeries(prep.mid, fpsA, time));
  const high = gain(sampleSeries(prep.high, fpsA, time));
  const onset = gain(sampleSeries(prep.onset, fpsA, time));

  const spectrum = spectrumOut ?? new Array<number>(prep.analysis.spectrumBands).fill(0);
  sampleSmoothedSpectrum(prep.spectrum, prep.analysis.spectrumBands, fpsA, time, spectrum);
  if (sens !== 1) {
    for (let i = 0; i < spectrum.length; i++) spectrum[i] = clamp(spectrum[i] * sens);
  }

  // 静音门限：原始响度极低时运动衰减；开头静音用时长做前导淡入
  const silenceGate = smoothstep(0.02, 0.12, rmsRaw) * smoothstep(0, 0.12, time);
  const energy = clamp(low * 0.42 + mid * 0.34 + high * 0.16 + rms * 0.28 + onset * 0.2);
  const intensity = clamp(visual.intensity, 0, 1);
  const motion = clamp(intensity * (0.35 + 0.65 * energy)) * clamp(0.25 + 0.75 * silenceGate);

  const beatStrength = beat.strength ?? 0.8;
  const pulseRaw = beat.pulse * (0.35 + 0.65 * beatStrength);
  const pulse = clamp(pulseRaw) * clamp(silenceGate) * (0.4 + 0.6 * intensity);
  const { pulse: onsetRaw } = onsetPulseAt(prep.analysis.onsetsSec, time);
  const onsetPulse = clamp(onsetRaw) * clamp(silenceGate);

  const sectionIndex = beat.bar8;
  const sectionProgress = beat.bar8Progress;
  const sectionSwing = Math.sin((sectionIndex + 0.35) * Math.PI * 0.5 + visual.seed * 0.0007);

  // 颜色：autoVariation 时在段落间于主色/辅色间漂移
  const base = resolveColors(visual.palette, visual.customColors);
  const variation = visual.autoVariation ? (0.5 + 0.5 * Math.sin(sectionProgress * Math.PI * 2)) : 0;
  const secondaryMix = visual.autoVariation ? variation * 0.55 : 0;
  const palette = {
    background: base.background,
    primary: mixColor(base.primary, base.secondary, secondaryMix),
    secondary: mixColor(base.secondary, base.primary, secondaryMix * 0.6),
    accent: base.accent,
  };

  const params = visual.templateParams ?? {};
  const param: ParamReader = {
    num(key, fallback) {
      const v = params[key];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    },
    bool(key, fallback) {
      const v = params[key];
      return typeof v === "boolean" ? v : fallback;
    },
  };

  return {
    frame,
    time,
    fps,
    width,
    height,
    unit: Math.min(width, height),
    visual,
    colors: base,
    palette,
    intensity,
    sensitivity: sens,
    analysis: prep,
    timeline,
    beat,
    rms,
    low,
    mid,
    high,
    onset,
    energy,
    spectrum,
    silenceGate,
    motion,
    pulse,
    onsetPulse,
    sectionIndex,
    sectionProgress,
    sectionSwing,
    bar4: beat.bar4,
    bar4Progress: beat.bar4Progress,
    seed: visual.seed,
    param,
    ...(duration < 0 ? {} : {}),
  };
}

/** 场景缓存：同一分析+配置重复构建 timeline 时避免重复计算 */
export class SceneEngine {
  private timeline: BeatTimeline | null = null;
  private prep: PreparedAnalysis | null = null;
  private key = "";
  private spectrumScratch: number[] = [];

  constructor(private visual: VisualConfig) {}

  configure(visual: VisualConfig) {
    this.visual = visual;
    this.timeline = null;
    this.key = "";
  }

  prepare(analysis: import("../shared/types.ts").AudioAnalysis) {
    const key = `${analysis.audioId}|${analysis.analysisVersion}|${analysis.durationSec}|${this.visual.rhythm.mode}|${this.visual.rhythm.bpm}|${this.visual.rhythm.offsetSec}|${this.visual.rhythm.rate}`;
    if (this.key !== key) {
      this.prep = prepareAnalysis(analysis);
      this.timeline = buildBeatTimeline(analysis, this.visual.rhythm);
      this.key = key;
    }
    return { prep: this.prep as PreparedAnalysis, timeline: this.timeline as BeatTimeline };
  }

  scene(analysis: import("../shared/types.ts").AudioAnalysis, frame: number, fps: number, width: number, height: number): Scene {
    const { prep, timeline } = this.prepare(analysis);
    return buildScene(
      { analysis: prep, timeline, visual: this.visual, frame, fps, width, height },
      this.spectrumScratch,
    );
  }
}

export function lowerBound(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 当前段落的随机起拍值，保证同段落内固定 */
export function sectionSeed(seed: number, section: number): number {
  return Math.floor((Math.sin(seed * 0.0001 + section * 12.9898) * 43758.5453) % 1 * 4294967296) >>> 0;
}

export function mix(a: number, b: number, t: number): number {
  return lerp(a, b, clamp(t));
}

export function paramNumber(v: TemplateParamValue | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
