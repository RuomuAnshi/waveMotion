import React from "react";
import { withAlpha, mixColor, clamp, lerp } from "../engine/random.ts";

/** 通用径向渐变背景 + 轻微暗角 */
export const Backdrop: React.FC<{
  scene: import("../engine/frame.ts").Scene;
  /** 额外中心光晕强度 0..1 */
  glow?: number;
  /** 渐变中心偏移（相对画面 0..1） */
  centerX?: number;
  centerY?: number;
}> = ({ scene, glow = 0.5, centerX = 0.5, centerY = 0.48 }) => {
  const { palette, width, height, energy, pulse, visual } = scene;
  const brightness = 0.55 + visual.backgroundBrightness * 0.9;
  const cx = centerX * 100;
  const cy = centerY * 100;
  const glowAmt = clamp((0.35 + energy * 0.5 + pulse * 0.25) * glow);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          `radial-gradient(120% 95% at ${cx}% ${cy}%, ${withAlpha(palette.primary, clamp(0.95 * brightness))} 0%, ${withAlpha(
            mixColor(palette.primary, palette.background, 0.55),
            clamp(0.9 * brightness),
          )} 42%, ${palette.background} 78%)`,
          `radial-gradient(85% 70% at ${cx - 6}% ${cy + 12}%, ${withAlpha(palette.secondary, 0.28 * glowAmt * brightness)} 0%, transparent 62%)`,
        ].join(", "),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(115% 120% at 50% 45%, transparent 42%, rgba(0,0,0,${0.45 + (1 - brightness) * 0.3}) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(60% 60% at ${cx}% ${cy}%, ${withAlpha(palette.accent, 0.06 + glowAmt * 0.1)} 0%, transparent 70%)`,
          mixBlendMode: "screen",
        }}
      />
      {/* 细噪点，避免大面积渐变的色带 */}
      <NoiseOverlay opacity={0.035} width={width} height={height} seed={visual.seed} />
    </div>
  );
};

/** 固定噪点（SVG 滤镜，确定性） */
export const NoiseOverlay: React.FC<{ opacity: number; width: number; height: number; seed: number }> = ({
  opacity,
}) => (
  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, mixBlendMode: "overlay" }}>
    <filter id="wm-noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" seed={1} />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#wm-noise)" />
  </svg>
);

/** SVG 多边形路径（抖动由确定性噪声控制） */
export function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
  wobble: number,
  seed: number,
  time: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const noise =
      Math.sin(i * 12.9898 + seed * 0.001 + Math.floor(time * 3) * 0.7) * wobble * 0.5 +
      Math.sin(i * 4.1 + Math.floor(time * 1.5) + seed * 0.002) * wobble * 0.25;
    const r = radius * (1 + noise * 0.09);
    pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
  }
  return `M${pts.join("L")}Z`;
}

export function cssEase(t: number): number {
  const c = clamp(t);
  return c < 0.5 ? 2 * c * c : 1 - 2 * (1 - c) * (1 - c);
}

export { lerp };
