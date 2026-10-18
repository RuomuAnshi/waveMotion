import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, smoothstep } from "../engine/random.ts";
import { Backdrop } from "./common.tsx";

/**
 * 镜像频谱：居中对称（或单向）的频谱条。
 * 频谱驱动高度，拍点增强亮度与整体缩放，静音段自动收束。
 */
export const MirrorSpectrum: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, spectrum, pulse, low, high, time, beat, param } = scene;
  const barCount = Math.max(8, Math.round(param.num("barCount", 36)));
  const mirrorAxis = param.bool("mirrorAxis", true);
  const barWidthRatio = param.num("barWidth", 0.62);
  const centerGlow = param.num("centerGlow", 0.6);

  const cx = W * 0.5;
  const baseline = H * 0.5;
  const totalW = W * 0.72;
  const slot = totalW / barCount;
  const barW = slot * barWidthRatio;
  const maxH = unit * (0.3 + low * 0.06 + pulse * 0.05);

  const bars: React.ReactNode[] = [];
  for (let i = 0; i < barCount; i++) {
    // 从中心向两侧映射频谱，让中间频段落在中间
    const idx = i / (barCount - 1);
    const band = spectrum[Math.min(spectrum.length - 1, Math.floor(Math.pow(idx, 1.25) * spectrum.length))];
    const shaped = Math.pow(band, 1.35) * (0.55 + 0.45 * Math.sin(idx * Math.PI));
    const h = Math.max(unit * 0.004, shaped * maxH);
    const x = cx - totalW / 2 + i * slot + (slot - barW) / 2;
    const hue = mixColor(palette.secondary, palette.primary, idx * 0.8);
    const bright = clamp(0.55 + shaped * 0.45 + pulse * 0.2);
    bars.push(
      <g key={`bar-${i}`}>
        <rect
          x={x}
          y={baseline - h}
          width={barW}
          height={h}
          rx={barW * 0.32}
          fill={withAlpha(mixColor(hue, palette.accent, shaped * 0.35), bright)}
        />
        {mirrorAxis && (
          <rect
            x={x}
            y={baseline}
            width={barW}
            height={h * 0.92}
            rx={barW * 0.32}
            fill={withAlpha(mixColor(hue, palette.primary, 0.35), bright * 0.72)}
          />
        )}
      </g>,
    );
    // 顶部高光点
    bars.push(
      <circle
        key={`cap-${i}`}
        cx={x + barW / 2}
        cy={baseline - h - barW * 0.5}
        r={barW * (0.18 + shaped * 0.16)}
        fill={withAlpha(palette.accent, clamp(shaped * 0.85))}
      />,
    );
    if (mirrorAxis) {
      bars.push(
        <circle
          key={`capd-${i}`}
          cx={x + barW / 2}
          cy={baseline + h * 0.92 + barW * 0.5}
          r={barW * (0.12 + shaped * 0.1)}
          fill={withAlpha(palette.accent, clamp(shaped * 0.45))}
        />,
      );
    }
  }

  const scale = 1 + pulse * 0.035 + smoothstep(0, 1, low) * 0.01;
  const glowR = unit * (0.2 + centerGlow * 0.25) * (1 + pulse * 0.2);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Backdrop scene={scene} glow={0.4} centerY={0.5} />
      <div
        style={{
          position: "absolute",
          left: cx - glowR,
          top: baseline - glowR * 0.55,
          width: glowR * 2,
          height: glowR * 1.1,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at center, ${withAlpha(palette.primary, 0.4 + high * 0.2)} 0%, transparent 70%)`,
          filter: `blur(${unit * 0.03}px)`,
          opacity: centerGlow,
        }}
      />
      <svg
        width={W}
        height={H}
        style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: `${cx}px ${baseline}px` }}
      >
        <defs>
          <filter id="ms-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={unit * 0.006} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="ms-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={withAlpha(palette.accent, 0.1)} />
            <stop offset="50%" stopColor={withAlpha(palette.accent, 0.55 + pulse * 0.4)} />
            <stop offset="100%" stopColor={withAlpha(palette.accent, 0.1)} />
          </linearGradient>
        </defs>
        <g filter="url(#ms-glow)" opacity={clamp(0.4 + scene.silenceGate * 0.7)}>
          {bars}
        </g>
        {/* 中轴线 */}
        <rect x={cx - totalW / 2} y={baseline - unit * 0.0015} width={totalW} height={unit * 0.003} fill="url(#ms-line)" />
        {/* 拍点沿中轴扩散 */}
        <rect
          x={cx - totalW * (0.1 + (1 - pulse) * 0.4)}
          y={baseline - unit * 0.002}
          width={totalW * (0.2 + (1 - pulse) * 0.8)}
          height={unit * 0.004}
          fill={withAlpha(palette.accent, pulse * 0.35)}
        />
      </svg>
    </div>
  );
};
