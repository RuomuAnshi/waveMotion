import React, { useCallback, useMemo, useRef, useState } from "react";
import type { AudioAnalysis } from "../../shared/types.ts";
import type { BeatTimeline } from "../../engine/beat.ts";

interface TimelineScrubberProps {
  analysis: AudioAnalysis;
  timeline: BeatTimeline;
  frame: number;
  totalFrames: number;
  fps: number;
  onSeekFrame: (frame: number) => void;
  loopRange: { start: number; end: number } | null;
  onSetLoop: (range: { start: number; end: number } | null) => void;
}

const HEIGHT = 84;

/** 波形 + 拍点 + 播放头的时间轴（点击/拖动定位） */
export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  analysis,
  timeline,
  frame,
  totalFrames,
  fps,
  onSeekFrame,
  loopRange,
  onSetLoop,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const durationSec = analysis.durationSec;
  const playheadX = totalFrames > 1 ? (frame / (totalFrames - 1)) * 100 : 0;

  const bars = useMemo(() => {
    const series = analysis.rms;
    const N = 240;
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * durationSec;
      const idx = Math.min(series.length - 1, Math.max(0, Math.round(t * analysis.frameRate)));
      out.push(series[idx] ?? 0);
    }
    const max = Math.max(0.001, ...out);
    return out.map((v) => v / max);
  }, [analysis, durationSec]);

  const positionToFrame = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * (totalFrames - 1));
    },
    [totalFrames],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    onSeekFrame(positionToFrame(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setHoverX(((e.clientX - rect.left) / rect.width) * 100);
    if (dragging) onSeekFrame(positionToFrame(e.clientX));
  };
  const handlePointerUp = () => setDragging(false);

  return (
    <div className="timeline">
      <div
        className="timeline-canvas"
        ref={containerRef}
        style={{ height: HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setDragging(false);
          setHoverX(null);
        }}
      >
        {/* 波形 */}
        <div className="timeline-wave">
          {bars.map((v, i) => (
            <div
              key={i}
              className="wave-bar"
              style={{
                height: `${Math.max(2, v * 100)}%`,
                left: `${(i / bars.length) * 100}%`,
                width: `${100 / bars.length + 0.15}%`,
              }}
            />
          ))}
        </div>

        {/* 拍点刻度 */}
        {timeline.times.map((t, i) => {
          const x = (t / durationSec) * 100;
          if (x < 0 || x > 100) return null;
          const strong = i % 4 === 0;
          return (
            <div
              key={`beat-${i}`}
              className={`beat-tick${strong ? " beat-tick-strong" : ""}`}
              style={{ left: `${x}%` }}
              title={`拍点 ${i + 1} · ${t.toFixed(2)}s`}
            />
          );
        })}

        {/* 起音事件 */}
        {analysis.onsetsSec.slice(0, 400).map((t, i) => {
          const x = (t / durationSec) * 100;
          if (x < 0 || x > 100) return null;
          return <div key={`on-${i}`} className="onset-tick" style={{ left: `${x}%` }} />;
        })}

        {/* 循环区间 */}
        {loopRange && (
          <div
            className="loop-region"
            style={{
              left: `${(loopRange.start / Math.max(1, totalFrames - 1)) * 100}%`,
              width: `${((loopRange.end - loopRange.start) / Math.max(1, totalFrames - 1)) * 100}%`,
            }}
          />
        )}

        {/* 悬停指示 */}
        {hoverX !== null && <div className="timeline-hover" style={{ left: `${hoverX}%` }} />}

        {/* 播放头 */}
        <div className="playhead" style={{ left: `${playheadX}%` }} />
      </div>
      <div className="timeline-legend">
        <span>
          <i className="legend-dot legend-beat" /> 拍点（每 4 拍加粗）
        </span>
        <span>
          <i className="legend-dot legend-onset" /> 起音事件
        </span>
        <span className="timeline-hint">点击或拖动定位</span>
      </div>
    </div>
  );
};
