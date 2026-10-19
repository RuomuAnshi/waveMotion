import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, lerp, smoothstep } from "../engine/random.ts";
import { NoiseOverlay } from "./common.tsx";

/**
 * 镜像频谱：以中轴对称展开的频谱条，低频居中、高频向两侧。
 * 频谱驱动条高，拍点增强亮度与整体缩放，静音段自动收束。
 */
export const MirrorSpectrum: React.FC<{ scene: Scene }> = ({ scene }) => {
  const {
    width: W,
    height: H,
    unit,
    palette,
    visual,
    spectrum,
    pulse,
    low,
    high,
    time,
    beat,
    param,
    sectionProgress,
    silenceGate,
  } = scene;

  const barCount = Math.max(8, Math.round(param.num("barCount", 36)));
  const mirror = param.bool("mirrorAxis", true);
  const barWidthRatio = param.num("barWidth", 0.62);
  const centerGlow = param.num("centerGlow", 0.6);

  const cx = W * 0.5;
  const baseline = H * (mirror ? 0.5 : 0.62);
  const totalW = W * 0.78;
  const slot = totalW / barCount;
  const barW = slot * clamp(barWidthRatio, 0.2, 0.95);
  const maxH = unit * (0.3 + low * 0.05 + pulse * 0.04);

  const bandAt = (u: number): number => {
    const n = spectrum.length;
    const f = clamp(u, 0, 0.999999) * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    return lerp(spectrum[i0] ?? 0, spectrum[i1] ?? 0, f - Math.floor(f));
  };

  const gap = Math.max(1, unit * 0.0012);
  const glowOpacity = clamp(0.4 + silenceGate * 0.7);
  const scale = 1 + pulse * 0.03 + low * 0.012;
  const wave = Math.sin(time * 0.6) * 0.5 + 0.5;

  const up: React.ReactNode[] = [];
  const down: React.ReactNode[] = [];

  for (let i = 0; i < barCount; i++) {
    // 中轴为低频：0 在中心，越靠边频率越高
    const d = (i + 0.5) / barCount; // 0..1 从中心到边缘
    const mirrored = i % 2 === 0;
    const idx = mirrored ? Math.floor(i / 2) : Math.floor((barCount - 1 - i) / 2);
    const u = (idx + 0.5) / (barCount / 2);
    const band = bandAt(Math.pow(clamp(u), 1.18));
    const shaped = Math.pow(band, 1.25) * (0.62 + 0.38 * Math.sin(d * Math.PI));
    const h = Math.max(unit * 0.005, shaped * maxH);
    const x = cx - totalW / 2 + i * slot + (slot - barW) / 2;
    const bright = clamp(0.5 + shaped * 0.5 + pulse * 0.22 + high * 0.1);
    const hue = mixColor(palette.primary, palette.secondary, d * 0.85 + sectionProgress * 0.15);
    const capY = baseline - h;

    up.push(
      <g key={`bar-${i}`}>
        <rect
          x={x}
          y={capY}
          width={barW}
          height={h}
          rx={Math.min(barW * 0.34, gap * 2)}
          fill="url(#ms-bar-up)"
          opacity={bright}
        />
        <rect x={x} y={capY} width={barW} height={Math.min(h, unit * 0.006)} rx={unit * 0.002} fill={withAlpha(palette.accent, clamp(0.35 + shaped * 0.6))} />
      </g>,
    );

    if (mirror) {
      // 倒影：从轴心向下渐变到透明，形如水面映出的频谱
      const dh = Math.max(unit * 0.012, h * (0.62 + 0.16 * wave));
      down.push(
        <g key={`mir-${i}`} opacity={clamp(0.34 + shaped * 0.46 + pulse * 0.12)}>
          <rect x={x} y={baseline} width={barW} height={dh} fill="url(#ms-bar-down)" />
        </g>,
      );
    }
  }

  const glowR = unit * (0.24 + centerGlow * 0.3) * (1 + pulse * 0.18);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: [
          `radial-gradient(130% 105% at 50% ${(baseline / H) * 100}%, ${withAlpha(mixColor(palette.primary, palette.background, 0.35), 0.95)} 0%, ${mixColor(palette.primary, palette.background, 0.78)} 40%, ${palette.background} 82%)`,
        ].join(", "),
        overflow: "hidden",
      }}
    >
      {/* 中心横向柔光 */}
      <div
        style={{
          position: "absolute",
          left: cx - glowR * 1.5,
          top: baseline - glowR * 0.5,
          width: glowR * 3,
          height: glowR,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at center, ${withAlpha(palette.secondary, clamp((0.3 + high * 0.22) * centerGlow))} 0%, transparent 72%)`,
          filter: `blur(${unit * 0.035}px)`,
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: `${cx}px ${baseline}px` }}>
        <defs>
          <linearGradient id="ms-bar-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mixColor(palette.accent, palette.secondary, 0.35)} stopOpacity={0.8} />
            <stop offset="42%" stopColor={palette.secondary} stopOpacity={0.9} />
            <stop offset="100%" stopColor={palette.primary} stopOpacity={0.6} />
          </linearGradient>
          <linearGradient id="ms-bar-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.secondary} stopOpacity={0.85} />
            <stop offset="35%" stopColor={palette.primary} stopOpacity={0.5} />
            <stop offset="100%" stopColor={palette.primary} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ms-axis" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={withAlpha(palette.accent, 0)} />
            <stop offset="50%" stopColor={withAlpha(palette.accent, 0.5 + pulse * 0.4)} />
            <stop offset="100%" stopColor={withAlpha(palette.accent, 0)} />
          </linearGradient>
          <filter id="ms-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation={unit * 0.0045} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#ms-glow)" opacity={glowOpacity}>
          {up}
          {down}
        </g>
        <rect x={cx - totalW / 2} y={baseline - unit * 0.0012} width={totalW} height={unit * 0.0024} fill="url(#ms-axis)" />
        <rect
          x={cx - totalW * (0.08 + (1 - pulse) * 0.42)}
          y={baseline - unit * 0.0018}
          width={totalW * (0.16 + (1 - pulse) * 0.84)}
          height={unit * 0.0036}
          fill={withAlpha(palette.accent, pulse * 0.4)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(110% 110% at 50% 50%, transparent 46%, rgba(0,0,0,${clamp(0.32 + (1 - visual.backgroundBrightness) * 0.4)}) 100%)`,
        }}
      />
      <NoiseOverlay opacity={0.03} width={W} height={H} seed={visual.seed} />
    </div>
  );
};
