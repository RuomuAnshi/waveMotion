import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, valueNoise2D, lerp } from "../engine/random.ts";
import { NoiseOverlay } from "./common.tsx";

/**
 * 流动光场：大面积色块漂移 + 多层柔和波纹 + 拍点局部涟漪。
 * 能量驱动形变幅度，拍点从中心产生波纹；静音段落整体收束。
 */
export const FlowField: React.FC<{ scene: Scene }> = ({ scene }) => {
  const {
    width: W,
    height: H,
    unit,
    palette,
    visual,
    low,
    mid,
    high,
    pulse,
    time,
    beat,
    param,
    seed,
    onsetPulse,
    sectionProgress,
    silenceGate,
  } = scene;

  const waveCount = Math.max(2, Math.round(param.num("waveCount", 4)));
  const rippleAmt = clamp(param.num("ripple", 0.6));
  const softness = clamp(param.num("softness", 0.7));
  const drift = clamp(param.num("drift", 0.5));

  const cx = W * 0.5;
  const cy = H * 0.5;

  // 拍点涟漪：自上次拍点起按时间扩散（最多 3 圈）
  const beatAge = beat.sinceSec;
  const ripples: React.ReactNode[] = [];
  if (beat.index >= 0 && rippleAmt > 0.02) {
    for (let k = 0; k < 3; k++) {
      const tt = (beatAge - k * 0.125) / 1.5;
      if (tt <= 0 || tt >= 1) continue;
      const r = unit * (0.06 + tt * 0.95);
      const a = Math.pow(1 - tt, 1.5) * 0.3 * rippleAmt * (0.55 + beat.strength * 0.65);
      ripples.push(
        <circle
          key={`rip-${k}`}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={withAlpha(palette.accent, a)}
          strokeWidth={unit * (0.009 * (1 - tt) + 0.0012)}
        />,
      );
    }
  }

  // 波纹层：整幅宽度的连续曲线，半透明填充叠加
  const steps = 56;
  const layers: React.ReactNode[] = [];
  for (let l = 0; l < waveCount; l++) {
    const k = waveCount <= 1 ? 0 : l / (waveCount - 1);
    const yBase =
      H * (0.18 + k * 0.62) + Math.sin(time * (0.18 + k * 0.11) + l * 1.7) * H * 0.045 * (0.4 + drift);
    const amp = H * (0.04 + k * 0.055) * (0.4 + low * 0.8 + pulse * 0.45) * (0.35 + silenceGate * 0.85);
    const phase = time * (0.55 + k * 0.42) + l * 1.3;

    const top: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * W;
      const n1 = valueNoise2D(t * 2.6 + l * 1.9 + time * (0.09 + drift * 0.16), l * 2.3, seed);
      const n2 = valueNoise2D(t * 6.4 + time * 0.17, l * 5.1 + 3.7, seed + 91);
      const y =
        yBase +
        Math.sin(t * Math.PI * 2 * (1.05 + k * 0.85) + phase) * amp * 0.72 +
        (n1 - 0.5) * amp * 1.25 +
        (n2 - 0.5) * amp * 0.5;
      top.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    const hue = mixColor(palette.primary, palette.secondary, clamp(k * 0.85 + sectionProgress * 0.22));
    const fillA = clamp((0.2 + k * 0.22) * (0.45 + low * 0.7 + pulse * 0.3)) * (0.35 + silenceGate * 0.85);
    layers.push(
      <g key={`layer-${l}`}>
        <path
          d={`M0,${H} L${top.join(" L")} L${W},${H} Z`}
          fill={withAlpha(hue, fillA)}
          stroke="none"
        />
        <path
          d={`M${top.join(" L")}`}
          fill="none"
          stroke={withAlpha(mixColor(hue, palette.accent, 0.55), clamp(0.16 + high * 0.3 + pulse * 0.18))}
          strokeWidth={unit * 0.0026}
        />
      </g>,
    );
  }

  // 顶部反向的一层，形成柔和的上下夹击
  const capPts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const n = valueNoise2D(t * 3.2 + time * 0.1, 11.3, seed + 17);
    const y = H * 0.1 + Math.sin(t * Math.PI * 2.4 + time * 0.42) * H * 0.03 * (0.5 + drift) + (n - 0.5) * H * 0.04;
    capPts.push(`${(t * W).toFixed(1)},${y.toFixed(1)}`);
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: palette.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(115% 95% at 50% 42%, ${mixColor(palette.primary, palette.secondary, 0.18 + sectionProgress * 0.3)} 0%, ${mixColor(
            palette.primary,
            palette.background,
            0.66,
          )} 40%, ${palette.background} 80%)`,
        }}
      />
      {/* 大面积柔光色块 */}
      {[0, 1, 2, 3].map((i) => {
        const a = time * (0.07 + i * 0.045) + i * 1.9;
        const px = W * (0.5 + Math.cos(a) * (0.19 + i * 0.05) * (0.5 + drift));
        const py = H * (0.5 + Math.sin(a * 0.78 + i * 1.4) * (0.14 + i * 0.045) * (0.5 + drift));
        const r = unit * (0.28 + i * 0.1 + low * 0.05);
        const col = mixColor(palette.secondary, palette.primary, (i % 2) * 0.6 + sectionProgress * 0.2);
        return (
          <div
            key={`blob-${i}`}
            style={{
              position: "absolute",
              left: px - r,
              top: py - r,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${withAlpha(col, clamp((0.24 + mid * 0.16) * (0.35 + silenceGate * 0.85)))} 0%, transparent 66%)`,
              filter: `blur(${unit * (0.04 + softness * 0.055)}px)`,
            }}
          />
        );
      })}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="ff-soft" x="-12%" y="-25%" width="124%" height="150%">
            <feGaussianBlur stdDeviation={unit * (0.0015 + softness * 0.009)} />
          </filter>
          {[0, 1, 2].map((i) => {
            const col = mixColor(palette.secondary, palette.accent, 0.25 + i * 0.18);
            return (
              <linearGradient key={`ffsg-${i}`} id={`ff-streak-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={withAlpha(col, 0)} />
                <stop offset="45%" stopColor={withAlpha(col, 0.34 + i * 0.08)} />
                <stop offset="100%" stopColor={withAlpha(col, 0)} />
              </linearGradient>
            );
          })}
          <filter id="ff-rip" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={unit * 0.0035} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* 斜向流动光带 */}
        {[0, 1, 2].map((i) => {
          const a = -28 + i * 9;
          const off = ((time * (0.06 + i * 0.035) + i * 0.37) % 1.4) - 0.2;
          const x = W * off;
          const w = W * (0.075 + i * 0.026);
          const col = mixColor(palette.secondary, palette.accent, 0.25 + i * 0.18);
          return (
            <rect
              key={`streak-${i}`}
              x={x}
              y={-H * 0.3}
              width={w}
              height={H * 1.6}
              fill={`url(#ff-streak-${i})`}
              opacity={clamp(0.2 + mid * 0.22) * (0.3 + silenceGate * 0.8)}
              transform={`rotate(${a} ${x + w / 2} ${H * 0.5})`}
            />
          );
        })}
        <g filter="url(#ff-soft)">{layers}</g>
        {/* 顶部柔光带 */}
        <path d={`M0,0 L${capPts.join(" L")} L${W},0 Z`} fill={withAlpha(mixColor(palette.primary, palette.background, 0.5), 0.35)} filter="url(#ff-soft)" />
        <g filter="url(#ff-rip)" opacity={clamp(0.4 + silenceGate * 0.8)}>
          {ripples}
        </g>
        {/* 拍点能量在中心的一次柔光膨胀 */}
        {(pulse > 0.05 || onsetPulse > 0.05) && (
          <circle
            cx={cx}
            cy={cy}
            r={unit * (0.12 + Math.max(pulse, onsetPulse) * 0.35)}
            fill={withAlpha(mixColor(palette.secondary, palette.accent, 0.3), Math.max(pulse, onsetPulse) * 0.09)}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(115% 110% at 50% 48%, transparent 46%, rgba(0,0,0,${clamp(
            0.38 + (1 - visual.backgroundBrightness) * 0.36,
          )}) 100%)`,
        }}
      />
      <NoiseOverlay opacity={0.028} width={W} height={H} seed={visual.seed} />
    </div>
  );
};
