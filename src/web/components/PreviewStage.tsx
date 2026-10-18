import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { WaveMotionBackground } from "../../remotion/root.tsx";
import { EMPTY_ANALYSIS } from "../../remotion/emptyAnalysis.ts";
import type { AudioAnalysis, OutputConfig, VisualConfig } from "../../shared/types.ts";
import { resolveOutputSpec } from "../../shared/types.ts";

interface PreviewStageProps {
  analysis: AudioAnalysis | null;
  /** 音频媒体地址，用于预览时播放原音；导出时不会传入。 */
  audioSrc?: string | null;
  visual: VisualConfig;
  output: OutputConfig;
  durationSec: number;
  onFrame: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  playerRef: React.RefObject<PlayerRef | null>;
  seekRequest: number | null;
  onSeekHandled: () => void;
}

/**
 * 预览舞台：用 Remotion Player 渲染与成片完全相同的 Composition。
 * 预览只缩小显示尺寸，像素尺寸仍是导出规格，因此取景与成片一致。
 */
export const PreviewStage: React.FC<PreviewStageProps> = ({
  analysis,
  audioSrc,
  visual,
  output,
  durationSec,
  onFrame,
  onPlayingChange,
  playerRef,
  seekRequest,
  onSeekHandled,
}) => {
  const spec = resolveOutputSpec(output);
  const totalFrames = Math.max(1, Math.ceil(durationSec * spec.fps - 1e-6));

  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const inputProps = useMemo(
    () => ({
      analysis: analysis ?? EMPTY_ANALYSIS,
      visual,
      output: { width: spec.width, height: spec.height, fps: spec.fps, totalFrames },
      audioSrc: audioSrc ?? undefined,
    }),
    [analysis, audioSrc, visual, spec.width, spec.height, spec.fps, totalFrames],
  );

  // 按容器可用空间等比计算播放器尺寸（letterbox，不裁切、不变形）
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const aspect = spec.width / spec.height;
    const update = () => {
      const rect = host.getBoundingClientRect();
      const availW = Math.max(80, rect.width);
      const availH = Math.max(80, rect.height);
      let width = availW;
      let height = width / aspect;
      if (height > availH) {
        height = availH;
        width = height * aspect;
      }
      setBox({ width: Math.floor(width), height: Math.floor(height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [spec.width, spec.height]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleFrame = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    const handlePlay = () => onPlayingChange(true);
    const handlePause = () => onPlayingChange(false);
    player.addEventListener("frameupdate", handleFrame as never);
    player.addEventListener("play", handlePlay);
    player.addEventListener("pause", handlePause);
    return () => {
      player.removeEventListener("frameupdate", handleFrame as never);
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("pause", handlePause);
    };
  }, [playerRef, onFrame, onPlayingChange]);

  useEffect(() => {
    if (seekRequest === null) return;
    playerRef.current?.seekTo(seekRequest);
    onSeekHandled();
  }, [seekRequest, playerRef, onSeekHandled]);

  return (
    <div className="preview-host" ref={hostRef}>
      {!analysis ? (
        <div className="preview-empty">
          <div className="preview-empty-icon">◍</div>
          <p>选择左侧音频后开始预览</p>
        </div>
      ) : (
        box && (
          <div
            className="preview-player-wrap"
            data-aspect={output.aspect}
            style={{ width: box.width, height: box.height }}
          >
            <Player
              ref={playerRef}
              component={WaveMotionBackground}
              inputProps={inputProps}
              durationInFrames={totalFrames}
              compositionWidth={spec.width}
              compositionHeight={spec.height}
              fps={spec.fps}
              style={{ width: box.width, height: box.height }}
              controls={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              acknowledgeRemotionLicense
              errorFallback={({ error }) => (
                <div className="preview-error">
                  <strong>预览出错</strong>
                  <pre>{error.message}</pre>
                </div>
              )}
            />
          </div>
        )
      )}
    </div>
  );
};
