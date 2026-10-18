import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, lerp } from "../engine/random.ts";
import { NoiseOverlay } from "./common.tsx";

/**
 * 几何隧道：一层层多边形环由远及近向外扩张，形成向前穿行的空间感。
 * 拍点驱动推进（拍点让隧道跳进一格），低频控制速度，高频控制边缘亮度。
 * 环的深度 t = ((i / N) + travel) % 1，半径随 t 指数增长（近大远小）。
 */
export const GeoTunnel: React.FC<{ scene: Scene }> = ({ scene }) => {
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
    spectrum,
    sectionSwing,
    sectionProgress,
    silenceGate,
  } = scene;

  const sides = Math.max(3, Math.round(param.num("sides", 6)));
  const ringCount = Math.max(4, Math.round(param.num("ringCount", 18)));
  const twist = clamp(param.num("twist", 0.45));
  const glow = clamp(param.num("glow", 0.55));

  const cx = W * 0.5;
  const cy = H * 0.5;
  const maxR = Math.hypot(W, H) * 0.62;
  const minR = unit * 0.012;

  // 推进量：连续漂移 + 拍点离散推进
  const beatPhase = scene.timeline.intervalSec > 0 ? clamp(beat.sinceSec / scene.timeline.intervalSec) : 0;
  const travel = time * (0.055 + low * 0.16) + beat.index * 0.085 + beatPhase * 0.02;
  const rotBase = time * (0.05 + mid * 0.2) * (0.35 + twist);

  type Ring = { d: string; w: number; col: string; a: number; t: number };
  const rings: Ring[] = [];

  for (let i = 0; i < ringCount; i++) {
    const t = ((i / ringCount + travel) % 1 + 1) % 1; // 0 远 -> 1 近
    // 半径指数增长：t=0 极远（小），t→1 冲出画面
    const radius = minR * Math.pow(maxR / minR, Math.pow(t, 1.5));
    const alpha = clamp(Math.pow(t, 1.35) * (0.82 + high * 0.2 - (1 - silenceGate) * 0.5));
    if (alpha < 0.015) continue;

    const rotation = rotBase + t * twist * Math.PI * 1.35 + sectionProgress * 0.4;
    const bandIdx = Math.min(spectrum.length - 1, Math.floor(t * spectrum.length));
    const bandE = spectrum[bandIdx] ?? 0;

    const pts: string[] = [];
    for (let s = 0; s < sides; s++) {
      const a = rotation + (s / sides) * Math.PI * 2;
      // 频段让近处的环略有起伏
      const r = radius * (1 + bandE * 0.1 * t);
      pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
    }

    const hue = mixColor(
      mixColor(palette.primary, palette.secondary, clamp(t * 0.8 + sectionProgress * 0.25)),
      palette.accent,
      clamp(Math.pow(t, 3.2) * 0.55),
    );
    rings.push({
      d: `M${pts.join("L")}Z`,
      w: unit * (0.0012 + Math.pow(t, 2.4) * 0.0085) * (0.7 + low * 0.6),
      col: hue,
      a: alpha,
      t,
    });
  }

  // 隧道内壁的连线，强化纵深感
  const wallCount = Math.min(sides, 8);
  const walls: React.ReactNode[] = [];
  for (let s = 0; s < wallCount; s++) {
    const a0 = rotBase + (s / sides) * Math.PI * 2 + 0.02 * twist;
    const a1 = rotBase + ((s + 1) / sides) * Math.PI * 2 - 0.02 * twist;
    walls.push(
      <path
        key={`wall-${s}`}
        d={`M${cx + Math.cos(a0) * minR},${cy + Math.sin(a0) * minR} L${cx + Math.cos(a0) * maxR * 1.1},${
          cy + Math.sin(a0) * maxR * 1.1
        } L${cx + Math.cos(a1) * maxR * 1.1},${cy + Math.sin(a1) * maxR * 1.1} L${cx + Math.cos(a1) * minR},${
          cy + Math.sin(a1) * minR
        } Z`}
        fill="none"
        stroke={withAlpha(mixColor(palette.primary, palette.secondary, s / wallCount), clamp(0.035 + mid * 0.05))}
        strokeWidth={unit * 0.0016}
      />,
    );
  }

  const coreR = unit * (0.035 + low * 0.02 + pulse * 0.016);

  return (
    <div style={{ position: "absolute", inset: 0, background: palette.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(95% 85% at 50% 50%, ${mixColor(palette.primary, palette.secondary, 0.2 + sectionProgress * 0.3)} 0%, ${mixColor(
            palette.primary,
            palette.background,
            0.72,
          )} 34%, ${palette.background} 74%)`,
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="gt-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={unit * (0.0016 + glow * 0.009)} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="gt-core">
            <stop offset="0%" stopColor={withAlpha(palette.accent, 0.88)} />
            <stop offset="38%" stopColor={withAlpha(palette.secondary, 0.42)} />
            <stop offset="100%" stopColor={withAlpha(palette.primary, 0)} />
          </radialGradient>
        </defs>
        <g opacity={clamp(0.3 + silenceGate * 0.8)}>{walls}</g>
        <g filter="url(#gt-glow)">
          {rings.map((r, i) => (
            <path
              key={`ring-${i}`}
              d={r.d}
              fill="none"
              stroke={withAlpha(r.col, r.a)}
              strokeWidth={r.w}
              strokeLinejoin="round"
              opacity={clamp(0.25 + r.t * 0.85)}
            />
          ))}
        </g>
        {/* 远端光源 */}
        <circle cx={cx} cy={cy} r={coreR * 5.2} fill="url(#gt-core)" opacity={clamp(0.45 + low * 0.45)} />
        <circle cx={cx} cy={cy} r={coreR} fill={withAlpha(palette.accent, clamp(0.55 + pulse * 0.45))} />
        {pulse > 0.04 && (
          <circle
            cx={cx}
            cy={cy}
            r={unit * (0.05 + (1 - pulse) * 0.5)}
            fill="none"
            stroke={withAlpha(palette.accent, pulse * 0.28)}
            strokeWidth={unit * 0.0026}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,${clamp(
            0.48 + (1 - visual.backgroundBrightness) * 0.32,
          )}) 100%)`,
        }}
      />
      <NoiseOverlay opacity={0.03} width={W} height={H} seed={visual.seed} />
    </div>
  );
};
