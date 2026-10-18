import type { AudioAnalysis } from "../shared/types.ts";
import { ANALYSIS_VERSION } from "../shared/types.ts";

/** 占位分析：仅用于 Studio/类型默认值，不会出现在真实渲染里 */
export const EMPTY_ANALYSIS: AudioAnalysis = {
  analysisVersion: ANALYSIS_VERSION,
  audioId: "",
  durationSec: 10,
  sampleRate: 44100,
  channels: 2,
  bpm: 120,
  beatsSec: [],
  onsetsSec: [],
  beatStrengths: [],
  frameRate: 60,
  rms: [0],
  rmsDb: [-120],
  low: [0],
  mid: [0],
  high: [0],
  onsetStrength: [0],
  spectrumBands: 32,
  spectrumFlat: new Array(32).fill(0),
  loudness: { peakDbfs: -120, silentIntroSec: 0, silentRatio: 1, meanDbfs: -120 },
  rhythm: { stability: 0, confidence: 0, needsCorrection: true, hint: "无音频" },
  warnings: [],
};
