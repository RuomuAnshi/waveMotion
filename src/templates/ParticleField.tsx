import React from "react";
import type { Scene } from "../engine/frame.ts";
import { hash2, clamp, withAlpha, mixColor, valueNoise2D } from "../engine/random.ts";
import { Backdrop } from "./common.tsx";

/**
 * 粒子星场：有纵深的粒子漂移与放射。
 * 低频推动速度，瞬态（起音/拍点）触发粒子爆发。
 * 粒子位置完全由 (seed, index, time) 解析计算 —— 任意帧跳转结果一致。
 */
export const ParticleField: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { width: W, height: H, unit, palette, low, mid, high, pulse, onsetPulse, time, seed, param, beat } = scene;
  const count = Math.round(param.num("particleCount", 180));
  const depth = param.num("depth", 0.6);
  const burstPower = param.num("burstPower", 0.55);
  const trails = param.num("trails", 0.4);

  const cx = W * 0.5;
  const cy = H * 0.5;
  const speed = 0.05 + low * 0.22 * (0.5 + depth) + beat.pulse * 0.06;
  const burst = onsetPulse * burstPower + pulse * 0.35 * burstPower;

  const stars: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = hash2(seed, i * 7 + 1);
    const b = hash2(seed, i * 7 + 2);
    const c = hash2(seed, i * 7 + 3);
    const d = hash2(seed, i * 7 + 4);

    // 极坐标 + 深度：z 越小越慢、越暗、越大
    const z = 0.15 + Math.pow(c, depth * 0.9 + 0.1) * 0.95;
    const angle0 = a * Math.PI * 2;
    const radiusNorm = Math.pow(b, 0.7);
    // 随时间沿半径外扩并循环（模拟向前穿行）
    const travel = (time * speed * (0.35 + z * 0.9) + d) % 1;
    const radial = (radiusNorm * 0.85 + travel * 1.15) % 1.15;
    // 爆发：额外向外推
    const push = burst * (0.05 + b * 0.12) * (0.4 + z);
    const radius = radiusNorm * (0.36 + radial * 0.85 + push) * Math.max(W, H) * 0.62;

    // 轻微涡旋
    const swirl = (0.12 + depth * 0.2) * Math.sin(time * 0.4 + a * 6.28) * (1 - z * 0.5);
    const angle = angle0 + swirl + time * (0.02 + c * 0.05) * (d > 0.5 ? 1 : -1);

    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius * (H / W) * 0.9;
    const size = unit * (0.0016 + z * 0.0055) * (1 + burst * 0.7);
    const alpha = clamp((0.18 + z * 0.55) * (0.55 + high * 0.35 + pulse * 0.35) * (0.4 + c * 0.6));
    const hue = mixColor(palette.accent, mixColor(palette.secondary, palette.primary, b), z * 0.45);

    stars.push(
      <g key={`p-${i}`}>
        {trails > 0.02 && (
          <line
            x1={px}
            y1={py}
            x2={cx + Math.cos(angle - 0.02 * trails) * radius * (1 - 0.05 * trails)}
            y2={cy + Math.sin(angle - 0.02 * trails) * radius * (H / W) * 0.9 * (1 - 0.05 * trails)}
            stroke={withAlpha(hue, alpha * 0.35 * trails)}
            strokeWidth={size * 0.9}
            strokeLinecap="round"
          />
        )}
        <circle cx={px} cy={py} r={size} fill={withAlpha(hue, alpha)} />
        {z > 0.7 && (
          <circle cx={px} cy={py} r={size * 3.2} fill={withAlpha(hue, alpha * 0.12)} />
        )}
      </g>,
    );
  }

  // 中心放射光（低频驱动）
  const rayCount = 9;
  const rays: React.ReactNode[] = [];
  for (let i = 0; i < rayCount; i++) {
    const a = (i / rayCount) * Math.PI * 2 + time * 0.08 + seed * 0.001;
    const len = unit * (0.2 + low * 0.25 + onsetPulse * 0.3);
    rays.push(
      <line
        key={`ray-${i}`}
        x1={cx + Math.cos(a) * unit * 0.04}
        y1={cy + Math.sin(a) * unit * 0.04}
        x2={cx + Math.cos(a) * len}
        y2={cy + Math.sin(a) * len}
        stroke={withAlpha(palette.accent, clamp(0.06 + low * 0.12))}
        strokeWidth={unit * 0.01}
        strokeLinecap="round"
      />,
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Backdrop scene={scene} glow={0.45} />
      {/* 星云：确定性噪声不可能直接用于 CSS，这里用多个模糊圆替代 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(50% 45% at ${50 + scene.sectionSwing * 12}% 45%, ${withAlpha(palette.primary, 0.3 + mid * 0.18)} 0%, transparent 68%)`,
          filter: `blur(${unit * 0.04}px)`,
        }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <g opacity={clamp(0.35 + scene.silenceGate * 0.75)}>
          {rays}
          {stars}
        </g>
      </svg>
    </div>
  );
};
