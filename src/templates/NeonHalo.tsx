import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, lerp } from "../engine/random.ts";
import { NoiseOverlay } from "./common.tsx";

/**
 * 霓虹光环：暗场中的多层发光环 + 频段轮廓 + 旋转轨迹。
 * 拍点让光环逐层向外扩散，频谱能量改变环形轮廓，低频控制整体辉光。
 * 所有位置仅依赖 time / beat / spectrum，跳帧结果一致。
 */
export const NeonHalo: React.FC<{ scene: Scene }> = ({ scene }) => {
  const {
    width: W,
    height: H,
    unit,
    palette,
    visual,
    pulse,
    low,
    high,
    spectrum,
    time,
    beat,
    param,
    sectionSwing,
    sectionProgress,
    sectionIndex,
    silenceGate,
  } = scene;

  const haloCount = Math.round(param.num("haloCount", 5));
  const glow = param.num("glow", 0.7);
  const rotation = param.num("rotation", 0.5);
  const spikes = param.num("spikes", 0.55);

  const cx = W * 0.5 + Math.sin(time * 0.23 + sectionIndex * 0.5) * unit * 0.05 * sectionSwing;
  const cy = H * 0.5 + Math.cos(time * 0.19 + sectionIndex * 0.37) * unit * 0.025 * sectionSwing;

  const points = 120;
  const rot = time * (0.16 + rotation * 0.62) + beat.beatCount * 0.07;
  const baseR = unit * (0.19 + low * 0.05) * (1 + pulse * 0.05);

  const bandCount = spectrum.length;
  const bandAt = (u: number): number => {
    const x = ((u % 1) + 1) % 1;
    const f = x * bandCount;
    const i0 = Math.floor(f) % bandCount;
    const i1 = (i0 + 1) % bandCount;
    return lerp(spectrum[i0] ?? 0, spectrum[i1] ?? 0, f - Math.floor(f));
  };

  const ringPath = (radius: number, phase: number, spikeAmt: number, spin: number): string => {
    const pts: string[] = [];
    for (let i = 0; i < points; i++) {
      const u = i / points;
      const a = u * Math.PI * 2 + rot * spin;
      const band = bandAt(u * (1 + phase * 0.12) + sectionProgress * 0.1);
      const spike =
        Math.pow(band, 1.45) * spikeAmt * 0.34 +
        Math.sin(a * 3 + phase * 2.1 + time * 1.05) * 0.018 +
        Math.sin(a * 7 + phase * 4.3 - time * 0.85) * 0.008;
      const r = radius * (1 + spike);
      pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
    }
    return `M${pts.join("L")}Z`;
  };

  const halos: React.ReactNode[] = [];
  for (let i = 0; i < haloCount; i++) {
    const k = haloCount <= 1 ? 0 : i / (haloCount - 1);
    const delayed = Math.pow(clamp(pulse), 1 + i * 0.7);
    const r = baseR * (0.46 + k * 1.46) * (1 + delayed * (0.1 + low * 0.07));
    const hull = mixColor(mixColor(palette.secondary, palette.primary, 0.18 + k * 0.25), palette.accent, 0.34 + k * 0.46);
    const alpha = clamp((0.95 - k * 0.42) * (0.55 + delayed * 0.42 + high * 0.2));
    const d = ringPath(r, i * 0.7, spikes, 1 - k * 0.3);
    halos.push(
      <g key={`halo-${i}`} opacity={clamp(0.35 + silenceGate * 0.65)}>
        <path
          d={d}
          fill="none"
          stroke={withAlpha(hull, alpha * 0.16)}
          strokeWidth={unit * (0.04 - k * 0.018)}
          strokeLinejoin="round"
        />
        <path
          d={d}
          fill="none"
          stroke={withAlpha(hull, clamp(alpha * 0.95))}
          strokeWidth={unit * (0.011 - k * 0.0044)}
          strokeLinejoin="round"
          filter="url(#nh-glow)"
        />
        <path
          d={d}
          fill="none"
          stroke={withAlpha(palette.accent, alpha)}
          strokeWidth={unit * (0.0024 - k * 0.0009)}
          strokeLinejoin="round"
        />
      </g>,
    );
  }

  // 旋转轨迹上的光点
  const sparks: React.ReactNode[] = [];
  const sparkCount = 6 + Math.round(rotation * 6);
  for (let i = 0; i < sparkCount; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const a = time * (0.42 + (i % 3) * 0.26) * dir + i * 2.11 + beat.beatCount * 0.05 * dir;
    const r = baseR * (0.72 + (i % 5) * 0.34);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    const dot = unit * (0.0036 + (i % 3) * 0.0018) * (1 + pulse * 0.35);
    sparks.push(
      <g key={`spark-${i}`}>
        <circle cx={px} cy={py} r={dot * 4.5} fill={withAlpha(palette.accent, 0.1)} />
        <circle cx={px} cy={py} r={dot * 2.2} fill={withAlpha(palette.accent, 0.35)} />
        <circle cx={px} cy={py} r={dot} fill={withAlpha(palette.accent, 0.95)} filter="url(#nh-glow)" />
      </g>,
    );
  }

  const outerR = baseR * 1.92;
  const circumference = 2 * Math.PI * outerR;

  return (
    <div style={{ position: "absolute", inset: 0, background: palette.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 92% at ${((cx / W) * 100).toFixed(2)}% ${((cy / H) * 100).toFixed(
            2,
          )}%, ${mixColor(palette.primary, palette.background, 0.3)} 0%, ${mixColor(
            palette.primary,
            palette.background,
            0.7,
          )} 44%, ${palette.background} 78%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cx - outerR,
          top: cy - outerR,
          width: outerR * 2,
          height: outerR * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${withAlpha(palette.primary, clamp(0.18 + low * 0.22 + pulse * 0.14))} 0%, ${withAlpha(
            mixColor(palette.secondary, palette.background, 0.55),
            0.16,
          )} 46%, transparent 72%)`,
          filter: `blur(${unit * (0.03 + glow * 0.05)}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cx - baseR * 0.95,
          top: cy - baseR * 0.95,
          width: baseR * 1.9,
          height: baseR * 1.9,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${withAlpha(palette.secondary, clamp(0.28 + low * 0.22 + pulse * 0.14))} 0%, ${withAlpha(palette.primary, 0.12)} 52%, transparent 74%)`,
          filter: `blur(${unit * 0.02}px)`,
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="nh-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={unit * (0.006 + glow * 0.024)} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {halos}
        {/* 扫描弧：提供方向感 */}
        <circle
          cx={cx}
          cy={cy}
          r={outerR}
          fill="none"
          stroke={withAlpha(palette.accent, 0.16 + pulse * 0.18)}
          strokeWidth={unit * 0.004}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.16} ${circumference}`}
          strokeDashoffset={-time * (0.12 + rotation * 0.3) * circumference * 0.35}
          transform={`rotate(${(-rot * 40).toFixed(2)} ${cx} ${cy})`}
        />
        {sparks}
        {/* 拍点冲击环 */}
        {pulse > 0.04 && (
          <circle
            cx={cx}
            cy={cy}
            r={baseR * (1.5 + (1 - pulse) * 1.7)}
            fill="none"
            stroke={withAlpha(palette.accent, pulse * 0.32)}
            strokeWidth={unit * (0.002 + pulse * 0.004)}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(105% 105% at 50% 50%, transparent 52%, rgba(0,0,0,${clamp(
            0.35 + (1 - visual.backgroundBrightness) * 0.35,
          )}) 100%)`,
        }}
      />
      <NoiseOverlay opacity={0.032} width={W} height={H} seed={visual.seed} />
    </div>
  );
};
