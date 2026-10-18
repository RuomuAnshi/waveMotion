import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, lerp, withAlpha, mixColor, shade } from "../engine/random.ts";
import { NoiseOverlay, polygonPath } from "./common.tsx";

/**
 * 渐变几何脉冲（首个模板，参考 assets/背景.mp4）
 *
 * 参考素材的视觉特征：
 * - 大面积紫红渐变，从品红中心向深紫/黑边缘过渡，无明显边界
 * - 一个粗白描边的多边形（近似圆形），带有手绘感的不规则顶点
 * - 形状在音乐推进中缓慢放大，某些段落几乎填满画面，四角露出深色背景
 * - 拍点上描边扩散、变亮，低频推动冲击幅度
 */
export const GradientPulse: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, pulse, low, mid, high, time, beat, spectrum, param, sectionIndex } =
    scene;

  const cx = W * 0.5;
  const cy = H * 0.5;
  const sides = Math.round(param.num("polygonSides", 10));
  const ringCount = Math.round(param.num("ringCount", 2));
  const wobble = param.num("wobble", 0.45);
  const blobAmount = param.num("blobAmount", 0.6);

  // ---- 缓慢构图呼吸：每 4 个 8 拍段落完成一次放大/收拢，与音乐段落对齐 ----
  const phase = ((sectionIndex % 8) + scene.sectionProgress) / 8; // 0..1
  const zoomCurve = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2 * 2); // 0..1..0
  // 放大时范围更大：小圆 -> 几乎填满画面
  const zoom = 0.34 + zoomCurve * 1.28;
  // 低频与拍点推动额外冲击
  const impact = pulse * (0.06 + low * 0.05);
  const radius = unit * zoom * (1 + impact) * (1 + scene.sectionSwing * 0.02);

  // 轮廓旋转：缓慢、不抢眼
  const rotate = time * 0.055 + beat.beatCount * 0.045;

  const path = polygonPath(cx, cy, radius, Math.max(3, sides), rotate, wobble, scene.seed, time);

  // 内圈填充：从中心稍亮过渡到边缘更深，制造体积感
  const interior = mixColor(palette.primary, palette.secondary, 0.35 + 0.25 * Math.sin(phase * Math.PI * 2));

  // 描边扩散的回声环（拍点触发，参考素材中常见的第二层细环）
  const echoes: React.ReactNode[] = [];
  const echoCount = Math.max(0, ringCount - 1);
  for (let i = 0; i < echoCount; i++) {
    const delayed = Math.pow(pulse, 1.6 + i * 1.2);
    const r = radius * (1 + 0.045 * (i + 1) + delayed * (0.1 + low * 0.08));
    const alpha = clamp((0.16 + delayed * 0.34) * (1 - i * 0.28)) * (0.6 + high * 0.5);
    echoes.push(
      <path
        key={`echo-${i}`}
        d={polygonPath(cx, cy, r, Math.max(3, sides), rotate * 0.98, wobble * 0.85, scene.seed + 31 + i, time)}
        fill="none"
        stroke={withAlpha(palette.accent, alpha)}
        strokeWidth={unit * (0.0065 - i * 0.002) * (1 + delayed * 0.9)}
        strokeLinejoin="round"
      />,
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* ---- 底层：参考素材的大面积紫红渐变（无硬边界） ---- */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(135% 120% at 50% ${45 + scene.sectionSwing * 4}%, ${shade(interior, 0.06)} 0%, ${shade(
              mixColor(palette.primary, palette.background, 0.42),
              0.02,
            )} 45%, ${shade(palette.background, -0.1)} 88%)`,
            `radial-gradient(80% 65% at ${38 + scene.sectionSwing * 6}% ${62 - scene.sectionSwing * 4}%, ${withAlpha(
              palette.secondary,
              0.26 * (0.5 + scene.visual.backgroundBrightness),
            )} 0%, transparent 72%)`,
          ].join(", "),
        }}
      />

      {/* ---- 主体多边形：填充 + 粗描边 ---- */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="gp-fill" cx="50%" cy="46%" r="72%">
            <stop offset="0%" stopColor={withAlpha(shade(interior, 0.16), 0.98)} />
            <stop offset="58%" stopColor={withAlpha(interior, 0.96)} />
            <stop offset="100%" stopColor={withAlpha(shade(interior, -0.22), 0.98)} />
          </radialGradient>
          <filter id="gp-soft" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation={unit * 0.012} />
          </filter>
          <filter id="gp-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={unit * (0.006 + blobAmount * 0.008)} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 柔和外扩：让形状边缘与背景融合（参考素材无硬边） */}
        <path d={path} fill={withAlpha(interior, 0.5)} filter="url(#gp-soft)" transform="scale(1.012)" transform-origin={`${cx} ${cy}`} />

        {/* 主体填充 */}
        <path d={path} fill="url(#gp-fill)" opacity={0.94} />

        {/* 内部微光：低频呼吸 */}
        <ellipse
          cx={cx}
          cy={cy - radius * 0.08}
          rx={radius * (0.55 + mid * 0.1)}
          ry={radius * (0.45 + mid * 0.08)}
          fill={withAlpha(shade(interior, 0.3), 0.18 + low * 0.12)}
          filter="url(#gp-soft)"
        />

        {/* 描边 + 辉光 */}
        <g filter="url(#gp-glow)">
          {echoes}
          <path
            d={path}
            fill="none"
            stroke={withAlpha(palette.accent, clamp(0.9 + pulse * 0.1))}
            strokeWidth={unit * (0.022 + pulse * 0.008) * (0.8 + scene.intensity * 0.45)}
            strokeLinejoin="round"
            opacity={0.96}
          />
        </g>

        {/* 高频细弧：只在能量强时出现，克制的点缀 */}
        {high > 0.45 &&
          [0, 1, 2].map((i) => {
            const a = rotate * 2.2 + i * 2.1;
            const r = radius * (1.06 + 0.05 * Math.sin(time * 1.4 + i));
            const k = clamp((high - 0.45) * 2.2) * (0.5 + 0.5 * spectrum[i + 2]);
            if (k < 0.05) return null;
            return (
              <circle
                key={`hi-${i}`}
                cx={cx + Math.cos(a) * r}
                cy={cy + Math.sin(a) * r}
                r={unit * (0.0035 + k * 0.004)}
                fill={withAlpha(palette.accent, k * 0.75)}
              />
            );
          })}
      </svg>

      {/* ---- 顶部渐晕，避免大面积色块过平 ---- */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(115% 120% at 50% 45%, transparent 45%, rgba(0,0,0,${0.42 + (1 - scene.visual.backgroundBrightness) * 0.25}) 100%)`,
          pointerEvents: "none",
        }}
      />
      <NoiseOverlay opacity={0.03} width={W} height={H} seed={scene.seed} />
    </div>
  );
};
