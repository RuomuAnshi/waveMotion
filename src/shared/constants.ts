import type {
  ColorSet,
  PaletteId,
  TemplateId,
  TemplateParamSpec,
  TemplateParams,
  VisualConfig,
  OutputConfig,
  TemplateMeta,
} from "./types.ts";

export const PALETTES: Record<Exclude<PaletteId, "custom">, { name: string; colors: ColorSet }> = {
  crimsonPurple: {
    name: "紫红渐变",
    colors: { background: "#12000c", primary: "#6d0b4e", secondary: "#a81616", accent: "#f4e9ff" },
  },
  neonNight: {
    name: "霓虹夜",
    colors: { background: "#03040f", primary: "#1b0b6b", secondary: "#0090ff", accent: "#7cf6ff" },
  },
  lavaSunset: {
    name: "熔岩日落",
    colors: { background: "#160603", primary: "#8f1d05", secondary: "#ff7a18", accent: "#ffe6b0" },
  },
  deepOcean: {
    name: "深海",
    colors: { background: "#001015", primary: "#003a4f", secondary: "#0f8fa8", accent: "#d8fbff" },
  },
  aurora: {
    name: "极光",
    colors: { background: "#03100d", primary: "#0c5241", secondary: "#7a2ff2", accent: "#c7ffe8" },
  },
  monochrome: {
    name: "墨白",
    colors: { background: "#070707", primary: "#2e2e2e", secondary: "#8f8f8f", accent: "#ffffff" },
  },
};

export const DEFAULT_CUSTOM_COLORS: ColorSet = {
  background: "#0b0210",
  primary: "#7d0f5c",
  secondary: "#c0263a",
  accent: "#ffeaf7",
};

export function resolveColors(palette: PaletteId, custom: ColorSet): ColorSet {
  if (palette === "custom") return custom;
  return PALETTES[palette].colors;
}

/** 每个模板的可调参数（只展示相关项） */
export const TEMPLATE_PARAMS: Record<TemplateId, TemplateParamSpec[]> = {
  gradientPulse: [
    { key: "polygonSides", label: "多边形边数", type: "number", min: 3, max: 24, step: 1, default: 10, hint: "描边主体的顶点数" },
    { key: "ringCount", label: "描边层数", type: "number", min: 1, max: 5, step: 1, default: 2 },
    { key: "blobAmount", label: "色彩扩散", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: "wobble", label: "轮廓抖动", type: "number", min: 0, max: 1, step: 0.05, default: 0.45 },
  ],
  neonHalo: [
    { key: "haloCount", label: "光环数量", type: "number", min: 2, max: 10, step: 1, default: 5 },
    { key: "glow", label: "辉光强度", type: "number", min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: "rotation", label: "旋转轨迹", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "spikes", label: "频段轮廓", type: "number", min: 0, max: 1, step: 0.05, default: 0.55 },
  ],
  mirrorSpectrum: [
    { key: "barCount", label: "频谱条数", type: "number", min: 12, max: 64, step: 2, default: 36 },
    { key: "mirrorAxis", label: "镜像方向", type: "boolean", default: true, hint: "关闭则只向下展开" },
    { key: "barWidth", label: "条宽比", type: "number", min: 0.2, max: 0.95, step: 0.05, default: 0.62 },
    { key: "centerGlow", label: "中心光晕", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  particleField: [
    { key: "particleCount", label: "粒子密度", type: "number", min: 40, max: 480, step: 20, default: 180 },
    { key: "depth", label: "纵深强度", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: "burstPower", label: "爆发力度", type: "number", min: 0, max: 1, step: 0.05, default: 0.55 },
    { key: "trails", label: "拖尾长度", type: "number", min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  geoTunnel: [
    { key: "sides", label: "隧道边数", type: "number", min: 3, max: 12, step: 1, default: 6 },
    { key: "ringCount", label: "环数", type: "number", min: 6, max: 40, step: 2, default: 18 },
    { key: "twist", label: "扭转强度", type: "number", min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: "glow", label: "边缘辉光", type: "number", min: 0, max: 1, step: 0.05, default: 0.55 },
  ],
  flowField: [
    { key: "waveCount", label: "波纹层数", type: "number", min: 2, max: 8, step: 1, default: 4 },
    { key: "ripple", label: "拍点波纹", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: "softness", label: "柔光程度", type: "number", min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: "drift", label: "色块漂移", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
};

export function defaultTemplateParams(template: TemplateId): TemplateParams {
  const out: TemplateParams = {};
  for (const spec of TEMPLATE_PARAMS[template]) out[spec.key] = spec.default;
  return out;
}

export function allDefaultTemplateParams(): Record<TemplateId, TemplateParams> {
  const out = {} as Record<TemplateId, TemplateParams>;
  for (const id of Object.keys(TEMPLATE_PARAMS) as TemplateId[]) out[id] = defaultTemplateParams(id);
  return out;
}

export const TEMPLATE_META: TemplateMeta[] = [
  {
    id: "gradientPulse",
    name: "渐变几何脉冲",
    description: "柔和渐变、圆形与多边形、描边扩散，贴近参考素材",
    params: TEMPLATE_PARAMS.gradientPulse,
  },
  {
    id: "neonHalo",
    name: "霓虹光环",
    description: "多层光环、辉光与旋转轨迹",
    params: TEMPLATE_PARAMS.neonHalo,
  },
  {
    id: "mirrorSpectrum",
    name: "镜像频谱",
    description: "居中或上下对称的频谱条",
    params: TEMPLATE_PARAMS.mirrorSpectrum,
  },
  {
    id: "particleField",
    name: "粒子星场",
    description: "有纵深的粒子漂移与放射",
    params: TEMPLATE_PARAMS.particleField,
  },
  {
    id: "geoTunnel",
    name: "几何隧道",
    description: "连续多边形形成向前穿行的空间感",
    params: TEMPLATE_PARAMS.geoTunnel,
  },
  {
    id: "flowField",
    name: "流动光场",
    description: "大面积色块、柔光与波纹流动",
    params: TEMPLATE_PARAMS.flowField,
  },
];

export const DEFAULT_OUTPUT: OutputConfig = {
  aspect: "16:9",
  resolution: "1080",
  fps: 30,
  includeAudio: true,
};

export const DEFAULT_VISUAL: VisualConfig = {
  template: "gradientPulse",
  palette: "crimsonPurple",
  customColors: DEFAULT_CUSTOM_COLORS,
  intensity: 0.5,
  sensitivity: 1,
  backgroundBrightness: 0.5,
  autoVariation: true,
  seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: defaultTemplateParams("gradientPulse"),
};

export const DEFAULT_BEAT_HINT = { enabled: false, volume: 0.5 };
