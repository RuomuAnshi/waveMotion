import React from "react";

import { Icon } from "./Icon.tsx";

interface TransportProps {
  frame: number;
  totalFrames: number;
  fps: number;
  playing: boolean;
  onToggle: () => void;
  onSeekFrame: (frame: number) => void;
  loopRange: { start: number; end: number } | null;
  onSetLoop: (range: { start: number; end: number } | null) => void;
  beatHintEnabled: boolean;
  onToggleBeatHint: () => void;
  durationSec: number;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export const Transport: React.FC<TransportProps> = ({
  frame,
  totalFrames,
  fps,
  playing,
  onToggle,
  onSeekFrame,
  loopRange,
  onSetLoop,
  beatHintEnabled,
  onToggleBeatHint,
  durationSec,
}) => {
  const timeSec = frame / fps;
  const inLoop = loopRange && frame >= loopRange.start && frame <= loopRange.end;

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className="btn btn-primary" onClick={onToggle} title="播放 / 暂停（空格）">
          <Icon name={playing ? "pause" : "play"} size={14} />{playing ? "暂停" : "播放"}
        </button>
        <button
          className="btn btn-ghost btn-icon"
          aria-label="回到开头"
          onClick={() => onSeekFrame(0)}
          title="回到开头"
        >
          <Icon name="start" size={14} />
        </button>
        <button className="btn btn-ghost" onClick={() => onSeekFrame(Math.round(frame - fps))} title="后退 1 秒">
          −1s
        </button>
        <button className="btn btn-ghost" onClick={() => onSeekFrame(Math.round(frame + fps))} title="前进 1 秒">
          +1s
        </button>
      </div>
      <div className="transport-time">
        <span className="mono">{formatTime(timeSec)}</span>
        <span className="transport-time-total">/ {formatTime(durationSec)}</span>
      </div>
      <div className="transport-loop">
        {loopRange ? (
          <>
            <span className="loop-badge">
              循环 {formatTime(loopRange.start / fps)} – {formatTime(loopRange.end / fps)}
            </span>
            <button className="btn btn-ghost" onClick={() => onSetLoop(null)}>
              取消循环
            </button>
          </>
        ) : (
          <button
            className="btn btn-ghost"
            onClick={() => onSetLoop({ start: 0, end: Math.max(0, totalFrames - 1) })}
            title="把整段音频设为循环区间"
          >
            区间循环
          </button>
        )}
      </div>
      <label className="transport-hint" title="预览时播放节拍提示音，不会进入成片">
        <input type="checkbox" checked={beatHintEnabled} onChange={onToggleBeatHint} />
        节拍提示音
      </label>
    </div>
  );
};
