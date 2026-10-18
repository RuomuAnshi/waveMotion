/**
 * 前后端、Remotion Composition 与预览共用的类型定义。
 * 修改这些类型时必须同步 python 分析脚本的输出结构（analysisVersion）。
 */

export const ANALYSIS_VERSION = "analysis-v2" as const;

/** 单个频谱频段的能量序列（0..1，已按时间轴重采样到 analysis.frameRate） */
export interface TimeSeries {
  frameRate: number;
  values: number[];
}

/** 音频离线分析结果（由 python/librosa 生成，按音频内容缓存） */
export interface AudioAnalysis {
  analysisVersion: string;
  audioId: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** 自动检测 BPM */
  bpm: number;
  /** 自动检测的拍点秒数 */
  beatsSec: number[];
  /** 起音事件秒数 */
  onsetsSec: number[];
  /** 每个自动拍点的强度 0..1，与 beatsSec 等长 */
  beatStrengths: number[];
  /** 时间轴采样率（帧/秒），后面所有序列均以此采样 */
  frameRate: number;
  /** 归一化响度包络 0..1 */
  rms: number[];
  /** 瞬时响度 dBFS（用于静音检测） */
  rmsDb: number[];
  /** 低/中/高频能量包络 0..1 */
  low: number[];
  mid: number[];
  high: number[];
  /** 起音强度包络 0..1 */
  onsetStrength: number[];
  /** 频谱频段数量（32） */
  spectrumBands: number;
  /** 展平的频谱帧数据，第 f 帧第 b 段 = spectrumFlat[f * spectrumBands + b] */
  spectrumFlat: number[];
  loudness: {
    peakDbfs: number;
    /** 开头静音时长（秒），无静音为 0 */
    silentIntroSec: number;
    /** 静音帧占比 0..1 */
    silentRatio: number;
    /** 平均响度 dBFS */
    meanDbfs: number;
  };
  rhythm: {
    /** 0..1，拍点间隔越稳定越接近 1 */
    stability: number;
    /** 拍点重音显著性 0..1：低值说明拍点可能只是噪声伪峰 */
    beatSalience?: number;
    /** 每个拍点的强度 */
    beatStrengths?: number[];
    /** 0..1，节拍检测置信度 */
    confidence: number;
    /** 是否需要用户手动校正 */
    needsCorrection: boolean;
    /** 说明文案（中文） */
    hint: string;
  };
  /** 警告列表，例如"音频开头为静音" */
  warnings: string[];
  /** 分析耗时（毫秒） */
  elapsedMs?: number;
}

export type TemplateId =
  | "gradientPulse"
  | "neonHalo"
  | "mirrorSpectrum"
  | "particleField"
  | "geoTunnel"
  | "flowField";

export const TEMPLATE_IDS: TemplateId[] = [
  "gradientPulse",
  "neonHalo",
  "mirrorSpectrum",
  "particleField",
  "geoTunnel",
  "flowField",
];

export type PaletteId =
  | "crimsonPurple"
  | "neonNight"
  | "lavaSunset"
  | "deepOcean"
  | "aurora"
  | "monochrome"
  | "custom";

export interface ColorSet {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
}

export interface RhythmConfig {
  /** auto = 使用检测拍点；manual = BPM + 起拍偏移生成规则拍点 */
  mode: "auto" | "manual";
  /** 手动 BPM，null 表示跟随自动分析 */
  bpm: number | null;
  /** 起拍偏移（秒），只移动视觉拍点，不移动音频 */
  offsetSec: number;
  /** 视觉响应速度：半速 / 正常 / 双速 */
  rate: 0.5 | 1 | 2;
}

export type AspectRatioId = "16:9" | "9:16" | "1:1";
export type ResolutionTier = "1080" | "1440";
export type Fps = 30 | 60;

export interface OutputConfig {
  aspect: AspectRatioId;
  resolution: ResolutionTier;
  fps: Fps;
  /** 是否保留原音轨；false 则只输出画面 */
  includeAudio: boolean;
}

/** 全局视觉配置（与模板无关部分） */
export interface VisualConfig {
  template: TemplateId;
  palette: PaletteId;
  /** 自定义配色，palette === "custom" 时使用 */
  customColors: ColorSet;
  /** 动感强度 0..1 */
  intensity: number;
  /** 响应灵敏度 0.25..2.5 */
  sensitivity: number;
  /** 背景亮度 0..1 */
  backgroundBrightness: number;
  /** 是否每 4/8 拍自动变化构图 */
  autoVariation: boolean;
  /** 固定随机种子，保证预览与导出、重复渲染一致 */
  seed: number;
  rhythm: RhythmConfig;
  /** 当前模板的模板参数 */
  templateParams: TemplateParams;
}

export type TemplateParamValue = number | boolean;
/** 每个模板各自的参数集合；键名见 TEMPLATE_PARAM_SCHEMA */
export type TemplateParams = Record<string, TemplateParamValue>;

/** 界面渲染模板参数控件用的 schema */
export interface TemplateParamSpec {
  key: string;
  label: string;
  type: "number" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  default: TemplateParamValue;
  hint?: string;
}

export interface TemplateMeta {
  id: TemplateId;
  name: string;
  description: string;
  params: TemplateParamSpec[];
}

/** 保存/载入的本地项目配置 */
export interface ProjectConfig {
  id?: string;
  name: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  audio: {
    audioId: string;
    name: string;
    durationSec: number;
  };
  visual: VisualConfig;
  output: OutputConfig;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface RenderJob {
  id: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 快照，提交后不再受界面编辑影响 */
  snapshot: {
    audioId: string;
    audioPath: string;
    visual: VisualConfig;
    output: OutputConfig;
    durationSec: number;
    totalFrames: number;
    width: number;
    height: number;
    includeAudio: boolean;
  };
  output?: {
    fileName: string;
    path: string;
    url: string;
    sizeBytes?: number;
  };
  error?: string;
  /** 第几次尝试（失败重试会递增） */
  attempt: number;
  /** 导出范围（秒），首版默认完整音频 */
  range?: { startSec: number; endSec: number };
}

export interface AnalysisJobStatus {
  id: string;
  audioId: string;
  status: JobStatus;
  progress: number;
  error?: string;
  analysis?: AudioAnalysis;
  cached?: boolean;
}

export interface AudioEntry {
  id: string;
  name: string;
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  source: "asset" | "import";
  /** 媒体读取地址 */
  url: string;
  sizeBytes: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  template: TemplateId;
  audioName: string;
  durationSec: number;
}

/** 渲染输出规格计算 */
export interface RenderSpec {
  width: number;
  height: number;
  fps: number;
  includeAudio: boolean;
}

export const OUTPUT_SIZE_TABLE: Record<
  AspectRatioId,
  Record<ResolutionTier, { width: number; height: number }>
> = {
  "16:9": {
    "1080": { width: 1920, height: 1080 },
    "1440": { width: 2560, height: 1440 },
  },
  "9:16": {
    "1080": { width: 1080, height: 1920 },
    "1440": { width: 1440, height: 2560 },
  },
  "1:1": {
    "1080": { width: 1080, height: 1080 },
    "1440": { width: 1440, height: 1440 },
  },
};

export function resolveOutputSpec(output: OutputConfig): RenderSpec {
  const size = OUTPUT_SIZE_TABLE[output.aspect][output.resolution];
  return {
    width: size.width,
    height: size.height,
    fps: output.fps,
    includeAudio: output.includeAudio,
  };
}

/** 音频样本数换算为总帧数：向上对齐到整帧，末尾误差小于一帧 */
export function durationToFrames(durationSec: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSec * fps - 1e-6));
}
