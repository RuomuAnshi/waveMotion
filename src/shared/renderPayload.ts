import type { AudioAnalysis, VisualConfig } from "./types.ts";

/**
 * Remotion Composition 的输入参数快照。
 * 导出时由后台在提交任务时生成一份纯 JSON 快照并通过 inputProps 传入，
 * 之后的界面编辑不会再影响该任务。
 */
export type WaveMotionProps = {
  analysis: AudioAnalysis;
  visual: VisualConfig;
  /** 输出尺寸/帧率（由导出参数决定，预览时用预览尺寸） */
  output: {
    width: number;
    height: number;
    fps: number;
    /** 成片总帧数（已按音频时长向上对齐） */
    totalFrames: number;
  };
  /**
   * 预览播放用的音频地址（仅预览传入）。
   * 导出时故意不传：成片音轨由后台用 ffmpeg 直接封装原音频，
   * 避免重新编码带来的时长漂移与额外损耗。
   */
  audioSrc?: string;
  /** 是否显示节拍提示音（仅预览，成片不含） */
  beatHint?: boolean;
  /** Remotion 需要 props 满足 Record<string, unknown> */
  [key: string]: unknown;
};
