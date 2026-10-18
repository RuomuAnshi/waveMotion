import { useEffect, useRef } from "react";

interface BeatHintOptions {
  enabled: boolean;
  playing: boolean;
  beatTimes: number[];
  timeSec: number;
}

/**
 * 预览用的节拍提示音：在拍点位置播放一声短促的点击。
 * 只在预览时发声，不参与导出。
 */
export function useBeatHint({ enabled, playing, beatTimes, timeSec }: BeatHintOptions) {
  const ctxRef = useRef<AudioContext | null>(null);
  const lastHitRef = useRef<number>(-1);

  useEffect(() => {
    if (!enabled) {
      lastHitRef.current = -1;
      return;
    }
    if (!playing) return;

    // 找到最近的拍点，若刚跨过就响一声
    let nearest = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < beatTimes.length; i++) {
      const delta = Math.abs(beatTimes[i] - timeSec);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = i;
      }
    }
    if (nearest < 0 || bestDelta > 0.045) return;
    if (lastHitRef.current === nearest) return;
    lastHitRef.current = nearest;

    try {
      let ctx = ctxRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        ctxRef.current = ctx;
      }
      void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      // 每 4 拍高一个八度，方便听出小节
      osc.frequency.value = nearest % 4 === 0 ? 1568 : 1046;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {
      /* 忽略音频设备错误 */
    }
  }, [enabled, playing, beatTimes, timeSec]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);
}
