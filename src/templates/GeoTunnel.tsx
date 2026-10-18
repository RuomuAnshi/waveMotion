import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor } from "../engine/random.ts";
import { Backdrop } from "./common.tsx";

/**
 * 几何隧道：连续多边形环向中心收缩，形成向前穿行的空间感。
 * 拍点驱动推进（每次拍点隧道跳进一格），能量控制旋转与纵深。
 */
export const GeoTunnel: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, low, mid, high, pulse, time, beat, param, spectrum } = scene;
  const sides = Math.round(param.num("sides", 6));
  const ringCount = Math.round(param.num("ringCount", 18));
  const twist = param.num("twist", 0.45);
  const glow = param.num("glow", 0.55);

  const cx = W * 0.5;
  const cy = H * 0.5;

  // 推进：连续时间 + 拍点离散推进，保证与拍点对齐
  const beatPhase = scene.timeline.intervalSec > 0 ? beat.sinceSec / scene.timeline.intervalSec : 0;
  const continuous = time * (0.12 + low * 0.35);
  const stepped = beat.index * (0.16 + pulse * 0.08);
  const travel = continuous + stepped + beatPhase * 0.05;

  const rotBase = time * (0.08 + mid * 0.28) * (0.4 + twist);
  const scale = Math.max(W, H);

  const rings: React.ReactNode[] = [];
  for (let i = 0; i < ringCount; i++) {
    // z: 1（近） -> 0（远）；循环滚动
    const raw = ((i / ringCount + travel) % 1 + 1) % 1;
    const z = raw; // 0 远, 1 近
    const depth = 0.06 + Math.pow(1 - z, 2.1) * 0.94; // 透视半径
    const radius = scale * (0.035 + depth * 0.62);
    const alpha = clamp(Math.pow(z, 1.6) * (0.7 + mid * 0.25 - high * 0.1));
    if (alpha < 0.02) continue;
    const rotation = rotBase + z * twist * Math.PI * 1.2 + i * 0.12;
    const lineW = unit * (0.0012 + z * 0.0042) * (0.6 + low * 0.9);

    const pts: string[] = [];
    const bandIdx = Math.floor(z * (spectrum.length - 1));
    const bandE = spectrum[bandIdx] ?? 0;
    for (let s = 0; s < sides; s++) {
      const a = rotation + (s / sides) * Math.PI * 2;
      const r = radius * (1 + bandE * 0.14 * Math.pow(z, 1.3));
      pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
    }
    const hue = mixColor(
      mixColor(palette.secondary, palette.primary, z),
      palette.accent,
      clamp(Math.pow(z, 3) * 0.45),
    );
    rings.push(
      <polygon
        key={`ring-${i}`}
        points={pts.join(" ")}
        fill="none"
        stroke={withAlpha(hue, alpha)}
        strokeWidth={lineW}
        strokeLinejoin="round"
        opacity={alpha}
      />,
    );
  }

  // 远端核心光
  const coreR = scale * (0.02 + low * 0.02 + pulse * 0.02);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Backdrop scene={scene} glow={0.4} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="gt-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation={unit * (0.002 + glow * 0.008)} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="gt-core">
            <stop offset="0%" stopColor={withAlpha(palette.accent, 0.9)} />
            <stop offset="55%" stopColor={withAlpha(palette.secondary, 0.4)} />
            <stop offset="100%" stopColor={withAlpha(palette.primary, 0)} />
          </radialGradient>
        </defs>
        <g filter="url(#gt-glow)" opacity={clamp(0.35 + scene.silenceGate * 0.8)}>
          {rings}
        </g>
        <circle cx={cx} cy={cy} r={coreR * 4} fill="url(#gt-core)" opacity={clamp(0.5 + low * 0.4)} />
        <circle cx={cx} cy={cy} r={coreR} fill={withAlpha(palette.accent, clamp(0.7 + pulse * 0.3))} />
        {/* 拍点冲击：向外的扩散环 */}
        {pulse > 0.04 && (
          <polygon
            points={Array.from({ length: sides }, (_, s) => {
              const a = rotBase + (s / sides) * Math.PI * 2;
              const r = scale * (0.05 + (1 - pulse) * 0.55);
              return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
            }).join(" ")}
            fill="none"
            stroke={withAlpha(palette.accent, pulse * 0.3)}
            strokeWidth={unit * 0.003}
          />
        )}
      </svg>
    </div>
  );
};
