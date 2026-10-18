import React from "react";
import type { Scene } from "../engine/frame.ts";
import { clamp, withAlpha, mixColor, shade } from "../engine/random.ts";
import { NoiseOverlay, polygonPath } from "./common.tsx";

/**
 * 渐变几何脉冲 —— 复刻 assets/背景.mp4 的视觉结构。
 *
 * 对参考素材逐帧量测得到的结论：
 * - 背景是铺满整帧的径向渐变（无硬边界）：中心洋红 ~ rgb(150,20,85)，
 *   四角暗红 ~ rgb(50,0,12)；色相在紫、红之间随段落缓慢游走
 * - 主体是一圈【很粗】的白色多边形描边（描边宽度约为画面高度的 6%，
 *   顶点数约 20~24，接近圆），随音乐从中小尺寸放大到接近/超出画面
 * - 白色描边有柔和的辉光外溢，整体亮度偏低（平均亮度约 40~80/255）
 */
export const GradientPulse: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, pulse, low, mid, high, time, beat, spectrum, param, sectionIndex, silenceGate } =
    scene;

  const cx = W * 0.5;
  const cy = H * 0.5;
  const base = unit;
  const sides = Math.round(param.num("polygonSides", 22));
  const ringCount = Math.round(param.num("ringCount", 1));
  const wobble = param.num("wobble", 0.42);
  const blobAmount = param.num("blobAmount", 0.6);
  const brightness = scene.visual.backgroundBrightness;

  // ---- 色相游走：段落之间在紫 ↔ 红之间缓慢变化，与参考素材一致 ----
  const huePhase = ((sectionIndex % 6) + scene.sectionProgress) / 6;
  const hueMix = 0.5 + 0.5 * Math.sin(huePhase * Math.PI * 2);
  // 中心洋红 / 边缘暗红分别漂移
  const centerColor = mixColor("#a01478", "#a82620", hueMix * 0.65);
  const edgeColor = mixColor("#4a0022", "#3a0008", hueMix);

  // ---- 描边环尺寸：8 拍一个完整呼吸（小 → 大 → 略收） ----
  const cycle = ((beat.beatCount % 8) + beat.bar8Progress) / 8;
  // 0.30 → 0.94（以短边为基准），拍点上再加一点冲击
  const breath = 0.30 + 0.64 * (0.5 - 0.5 * Math.cos(cycle * Math.PI * 2));
  const impact = pulse * (0.05 + low * 0.05);
  const radius = base * breath * (1 + impact) * (0.96 + scene.sectionSwing * 0.03);

  const rotate = time * 0.03 + beat.beatCount * 0.02;
  const ringPath = polygonPath(cx, cy, radius, Math.max(6, sides), rotate, wobble, scene.seed, time);

  // 描边宽度：参考素材约画面高度的 6%，随拍点略增
  const strokeW = base * (0.056 + pulse * 0.01) * (0.85 + scene.intensity * 0.3);
  const ringAlpha = clamp(0.92 + pulse * 0.08) * (0.45 + 0.55 * silenceGate);

  // 回声环（ringCount > 1 时在外侧再叠一圈细环）
  const echoes: React.ReactNode[] = [];
  for (let i = 1; i < ringCount; i++) {
    const r = radius * (1 + 0.09 * i) * (1 + pulse * 0.02);
    echoes.push(
      <path
        key={`echo-${i}`}
        d={polygonPath(cx, cy, r, Math.max(6, sides), rotate * 0.97, wobble * 0.8, scene.seed + 17 * i, time)}
        fill="none"
        stroke={withAlpha("#ffffff", clamp((0.34 - i * 0.08) * (0.6 + high * 0.6)))}
        strokeWidth={strokeW * (0.16 - i * 0.03)}
        strokeLinejoin="round"
        strokeLinecap="round"
      />,
    );
  }

  // 背景光心缓慢游移
  const lightX = 50 + Math.sin(time * 0.16 + sectionIndex * 0.7) * 6;
  const lightY = 48 + Math.cos(time * 0.13) * 5;
  // 内部暖光：低频驱动的呼吸
  const innerGlow = 0.2 + low * 0.16 + pulse * 0.08;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* 铺满整帧的径向渐变背景（参考素材的主要底子） */}
          <radialGradient id="gp-bg" cx={`${lightX}%`} cy={`${lightY}%`} r="72%">
            <stop offset="0%" stopColor={shade(centerColor, 0.16 + brightness * 0.1)} />
            <stop offset="38%" stopColor={shade(centerColor, -0.02)} />
            <stop offset="68%" stopColor={shade(mixColor(centerColor, edgeColor, 0.6), -0.16)} />
            <stop offset="100%" stopColor={shade(edgeColor, -0.28)} />
          </radialGradient>
          {/* 描边辉光 */}
          <filter id="gp-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation={base * (0.008 + blobAmount * 0.014)} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* 轻微柔边，还原参考素材描边不锐利的质感 */}
          <filter id="gp-soft-edge" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={base * 0.0018} />
          </filter>
        </defs>

        {/* 全屏渐变底 */}
        <rect x={0} y={0} width={W} height={H} fill="url(#gp-bg)" />

        {/* 环内再压一点暗，强化描边与内部的层次 */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={radius * 0.96}
          ry={radius * 0.96}
          fill={withAlpha(shade(centerColor, 0.3), innerGlow * 0.42)}
          filter="url(#gp-soft-edge)"
        />

        {/* 白色粗描边环 */}
        <g filter="url(#gp-glow)">
          {echoes}
          <path
            d={ringPath}
            fill="none"
            stroke={withAlpha("#ffffff", clamp(ringAlpha))}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>

        {/* 高频小光点：能量强时沿环外侧散落（参考素材偶尔出现） */}
        {high > 0.52 &&
          [0, 1, 2].map((i) => {
            const a = rotate * 2.6 + i * 2.0;
            const r = radius * (1.08 + 0.05 * Math.sin(time * 1.1 + i));
            const k = clamp((high - 0.52) * 2.6) * (0.4 + 0.6 * spectrum[i + 2]);
            if (k < 0.06) return null;
            return (
              <circle
                key={`hi-${i}`}
                cx={cx + Math.cos(a) * r}
                cy={cy + Math.sin(a) * r}
                r={base * (0.003 + k * 0.003)}
                fill={withAlpha("#ffffff", k * 0.65)}
              />
            );
          })}

        {/* 低频驱动的内部细微纹理：用两条很淡的同心弧表现 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius * (0.62 + mid * 0.05)}
          fill="none"
          stroke={withAlpha("#ffffff", 0.05 + mid * 0.05)}
          strokeWidth={base * 0.002}
        />
      </svg>

      {/* 四角压暗：还原参考素材边缘更暗的包围感 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(${base * 0.92}px ${base * 0.92}px at ${lightX}% ${lightY}%, transparent 25%, rgba(0,0,0,${clamp(
            0.5 - brightness * 0.28,
            0.14,
            0.7,
          )}) 100%)`,
          pointerEvents: "none",
        }}
      />
      <NoiseOverlay opacity={0.02} width={W} height={H} seed={scene.seed} />
    </div>
  );
};
