import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, valueNoise2D } from "../engine/random.ts";
import { Backdrop } from "./common.tsx";

/**
 * 流动光场：大面积色块、柔光与波纹流动。
 * 能量驱动形变，拍点产生局部波纹（从中心扩散的圆环）。
 */
export const FlowField: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, low, mid, high, pulse, time, beat, param, spectrum, seed } =
    scene;
  const waveCount = Math.round(param.num("waveCount", 4));
  const rippleAmt = param.num("ripple", 0.6);
  const softness = param.num("softness", 0.7);
  const drift = param.num("drift", 0.5);

  const cx = W * 0.5;
  const cy = H * 0.5;

  // 拍点波纹：自上次拍点起扩散
  const rippleT = clamp(beat.sinceSec / 1.4);
  const ripples: React.ReactNode[] = [];
  if (beat.index >= 0 && rippleAmt > 0.02) {
    for (let k = 0; k < 3; k++) {
      const tt = clamp(rippleT - k * 0.16);
      if (tt <= 0 || tt >= 1) continue;
      const r = unit * (0.08 + tt * 0.75);
      const a = (1 - tt) * 0.3 * rippleAmt * (0.6 + beat.strength * 0.6);
      ripples.push(
        <circle
          key={`rip-${k}`}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={withAlpha(palette.accent, a)}
          strokeWidth={unit * (0.012 * (1 - tt) + 0.001)}
        />,
      );
    }
  }

  // 波浪层：SVG 路径，用确定性噪声 + 正弦
  const layers: React.ReactNode[] = [];
  const steps = 48;
  for (let l = 0; l < waveCount; l++) {
    const k = l / Math.max(1, waveCount - 1);
    const yBase = H * (0.22 + k * 0.56) + Math.sin(time * (0.22 + k * 0.13) + l) * H * 0.035 * drift;
    const amp = H * (0.035 + k * 0.045) * (0.4 + low * 0.9 + pulse * 0.35);
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      const t = i / steps;
      const n = valueNoise2D(t * 3.1 + l * 1.7 + time * (0.14 + drift * 0.22), l * 2.3, seed);
      const n2 = valueNoise2D(t * 7.3 + time * 0.26, l * 5.1 + 3, seed + 91);
      const y =
        yBase +
        Math.sin(t * Math.PI * 2 * (1.1 + k * 0.9) + time * (0.7 + k * 0.5) + l * 1.3) * amp * 0.55 +
        (n - 0.5) * amp * 1.5 +
        (n2 - 0.5) * amp * 0.6;
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    const hue = mixColor(palette.primary, palette.secondary, k * 0.9 + scene.sectionProgress * 0.25);
    const fill = withAlpha(hue, clamp(0.1 + k * 0.14 + low * 0.1));
    const blur = unit * (0.006 + softness * 0.04);
    layers.push(
      <g key={`layer-${l}`} filter="url(#ff-blur)">
        <path d={`M0,${H} L${pts.join(" L")} L${W},${H} Z`} fill={fill} opacity={clamp(0.5 + scene.silenceGate * 0.6)} />
        <path
          d={`M${pts.join(" L")}`}
          fill="none"
          stroke={withAlpha(palette.accent, clamp(0.05 + high * 0.16))}
          strokeWidth={unit * 0.0025}
        />
        <ellipse cx={W * (0.2 + k * 0.5 + Math.sin(time * 0.2 + l) * 0.08 * drift)} cy={yBase} rx={blur * 4} ry={blur * 2.2} fill={withAlpha(hue, 0.16)} />
      </g>,
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Backdrop scene={scene} glow={0.55} />
      {/* 大面积柔光色块 */}
      {[0, 1, 2].map((i) => {
        const a = time * (0.12 + i * 0.07) + i * 2.0;
        const px = W * (0.5 + Math.cos(a) * (0.22 + i * 0.05) * drift);
        const py = H * (0.5 + Math.sin(a * 0.8 + i) * (0.16 + i * 0.04) * drift);
        const r = unit * (0.3 + i * 0.1 + low * 0.06);
        const col = mixColor(palette.primary, palette.secondary, i / 2 + scene.sectionProgress * 0.2);
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
              background: `radial-gradient(circle, ${withAlpha(col, 0.42 + mid * 0.18)} 0%, transparent 68%)`,
              filter: `blur(${unit * (0.03 + softness * 0.05)}px)`,
            }}
          />
        );
      })}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="ff-blur" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation={unit * (0.002 + softness * 0.012)} />
          </filter>
          <filter id="ff-rip" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={unit * 0.004} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {layers}
        <g filter="url(#ff-rip)">{ripples}</g>
      </svg>
    </div>
  );
};
