import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, lerp } from "../engine/random.ts";
import { Backdrop } from "./common.tsx";

/**
 * 霓虹光环：多层同心光环 + 辉光 + 旋转轨迹。
 * 拍点触发扩散，频段能量改变环形轮廓（径向尖刺）。
 */
export const NeonHalo: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, pulse, low, mid, high, spectrum, time, beat, param, sectionSwing } =
    scene;
  const cx = W * 0.5 + Math.sin(time * 0.25 + scene.sectionIndex * 0.4) * unit * 0.02 * sectionSwing;
  const cy = H * 0.5;
  const haloCount = Math.round(param.num("haloCount", 5));
  const glow = param.num("glow", 0.7);
  const rotation = param.num("rotation", 0.5);
  const spikes = param.num("spikes", 0.55);

  const baseR = unit * (0.16 + low * 0.04);
  const points = 96;
  const rot = time * (0.22 + rotation * 0.9) + beat.beatCount * 0.1;

  const ringPath = (radius: number, phase: number, spikeAmt: number) => {
    const pts: string[] = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2 + rot * (0.35 + phase * 0.2);
      const band = spectrum[Math.floor((i / points) * spectrum.length)];
      const spike =
        Math.pow(band, 1.6) * spikeAmt * 0.42 +
        Math.sin(a * 3 + phase * 2.1 + time * 1.4) * 0.028 +
        Math.sin(a * 7 + phase * 4.3 - time * 0.9) * 0.014;
      const r = radius * (1 + spike);
      pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
    }
    return `M${pts.join("L")}Z`;
  };

  const halos: React.ReactNode[] = [];
  for (let i = 0; i < haloCount; i++) {
    const k = i / Math.max(1, haloCount - 1);
    const delayed = Math.pow(pulse, 1 + i * 0.55);
    const r = baseR * (0.55 + k * 1.5) * (1 + delayed * (0.1 + low * 0.06));
    const hue = mixColor(palette.primary, palette.secondary, k * 0.85 + scene.sectionProgress * 0.2);
    const alpha = clamp((0.72 - k * 0.5) * (0.5 + delayed * 0.7 + high * 0.25));
    halos.push(
      <g key={`halo-${i}`}>
        <path
          d={ringPath(r, i, spikes)}
          fill="none"
          stroke={withAlpha(hue, alpha)}
          strokeWidth={unit * (0.016 - k * 0.008 + delayed * 0.007)}
          strokeLinejoin="round"
          filter="url(#nh-glow)"
        />
        <path
          d={ringPath(r, i, spikes)}
          fill="none"
          stroke={withAlpha(palette.accent, alpha * 0.55)}
          strokeWidth={unit * 0.003}
          strokeLinejoin="round"
        />
      </g>,
    );
  }

  // 旋转轨迹：若干围绕中心的点/弧
  const orbitCount = 3;
  const orbits: React.ReactNode[] = [];
  for (let i = 0; i < orbitCount; i++) {
    const speed = (0.4 + i * 0.27) * (rotation * 1.6 + 0.25) * (i % 2 === 0 ? 1 : -1);
    const a = time * speed + i * 2.1 + beat.beatCount * 0.12 * (i % 2 === 0 ? 1 : -1);
    const r = baseR * (1.75 + i * 0.32 + mid * 0.14);
    const dot = unit * (0.008 + mid * 0.006);
    orbits.push(
      <g key={`orbit-${i}`}>
        <circle cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} r={dot * 2.6} fill={withAlpha(palette.accent, 0.12)} />
        <circle cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} r={dot} fill={withAlpha(palette.accent, 0.95)} />
        <circle cx={cx + Math.cos(a + 0.5) * r * 0.92} cy={cy + Math.sin(a + 0.5) * r * 0.92} r={dot * 0.6} fill={withAlpha(palette.accent, 0.6)} />
      </g>,
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Backdrop scene={scene} glow={0.5 + glow * 0.4} />
      {/* 中心辉光 */}
      <div
        style={{
          position: "absolute",
          left: cx - unit * 0.42,
          top: cy - unit * 0.42,
          width: unit * 0.84,
          height: unit * 0.84,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${withAlpha(palette.primary, clamp(0.35 + mid * 0.3))} 0%, ${withAlpha(
            mixColor(palette.secondary, palette.background, 0.4),
            0.22,
          )} 45%, transparent 70%)`,
          filter: `blur(${unit * (0.02 + glow * 0.05)}px)`,
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="nh-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={unit * (0.004 + glow * 0.022)} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g opacity={clamp(0.35 + scene.silenceGate * 0.8)}>
          {halos}
          {orbits}
        </g>
        {/* 拍点扩散的冲击环 */}
        {pulse > 0.05 && (
          <circle
            cx={cx}
            cy={cy}
            r={baseR * (1.4 + (1 - pulse) * 1.5)}
            fill="none"
            stroke={withAlpha(palette.accent, pulse * 0.4)}
            strokeWidth={unit * 0.003}
          />
        )}
      </svg>
    </div>
  );
};
