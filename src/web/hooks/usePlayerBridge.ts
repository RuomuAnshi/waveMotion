import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";

export interface PlayerBridge {
  playerRef: React.RefObject<PlayerRef | null>;
  frame: number;
  playing: boolean;
  seek: (frame: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
}

/**
 * 把 Remotion Player 的播放状态桥接到 React 状态。
 * 预览的每一帧都来自真正的 Composition，因此与导出结果完全一致。
 */
export function usePlayerBridge(): PlayerBridge {
  const playerRef = useRef<PlayerRef | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame as never);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame as never);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, []);

  // PlayerRef 在挂载后才有值，轮询一次补挂监听
  useEffect(() => {
    const id = window.setTimeout(() => {
      const player = playerRef.current;
      if (!player) return;
      const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      player.addEventListener("frameupdate", onFrame as never);
      player.addEventListener("play", onPlay);
      player.addEventListener("pause", onPause);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const seek = useCallback((next: number) => {
    playerRef.current?.seekTo(Math.max(0, Math.round(next)));
  }, []);
  const toggle = useCallback(() => playerRef.current?.toggle(), []);
  const play = useCallback(() => playerRef.current?.play(), []);
  const pause = useCallback(() => playerRef.current?.pause(), []);

  return { playerRef, frame, playing, seek, toggle, play, pause };
}
