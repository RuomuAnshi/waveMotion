import React from "react";
import type { Scene } from "../engine/frame.ts";
import { hash2, clamp, withAlpha, mixColor, lerp } from "../engine/random.ts";
import { NoiseOverlay } from "./common.tsx";

/**
 * 粒子星场：有纵深感的粒子由中心向外漂移（模拟向前穿行）。
 * 低频推动速度，瞬态（起音/拍点）触发向外爆发。
 * 每个粒子的位置完全由 (seed, index, time) 解析计算 —— 任意帧跳转结果一致。
 */
export const ParticleField: React.FC<{ scene: Scene }> = ({ scene }) => {
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
    onsetPulse,
    time,
    seed,
    param,
    beat,
    sectionSwing,
    sectionProgress,
    silenceGate,
  } = scene;

  const count = Math.round(param.num("particleCount", 180));
  const depth = clamp(param.num("depth", 0.6));
  const burstPower = clamp(param.num("burstPower", 0.55));
  const trails = clamp(param.num("trails", 0.4));

  const cx = W * 0.5;
  const cy = H * 0.5;
  const aspect = H / W;

  // 速度：低频与拍点推动；纵深越强越明显
  const speed = (0.035 + low * 0.14 * (0.45 + depth) + beat.pulse * 0.035) * (0.7 + sectionSwing * 0.6);
  const burst = onsetPulse * burstPower + pulse * 0.3 * burstPower;
  const maxR = Math.hypot(W, H) * 0.55;

  type Star = { px: number; py: number; tx: number; ty: number; r: number; a: number; col: string };

  const near: Star[] = [];
  const far: Star[] = [];

  for (let i = 0; i < count; i++) {
    const a1 = hash2(seed, i * 11 + 1);
    const a2 = hash2(seed, i * 11 + 2);
    const a3 = hash2(seed, i * 11 + 3);
    const a4 = hash2(seed, i * 11 + 4);
    const a5 = hash2(seed, i * 11 + 5);

    // z：0 远、1 近
    const z = 0.12 + Math.pow(a3, 1.7 - depth * 0.6) * 0.88;
    // 出射方向固定（不随拍点变动，避免闪烁）
    const angle = a1 * Math.PI * 2;
    // 归一化起始半径
    const r0 = Math.pow(a2, 0.62);
    // 循环外移：z 大的近处粒子移动更快
    const cycle = 1.12;
    const travelled = (time * speed * (0.35 + z * 1.15) + a4) % cycle;
    const rNorm = (r0 * 0.35 + travelled) % cycle;
    // 爆发只加在半径上，且随 z 衰减 —— 连续函数，不会跳变
    const push = burst * 0.14 * (0.35 + z * 0.85);

    const radius = (rNorm + push) * maxR;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius * aspect;
    // 拖尾指向中心方向，长度与速度/纵深相关
    const tailLen = trails * (0.08 + speed * 3.4) * (0.35 + z);
    const tx = cx + Math.cos(angle) * radius * (1 - tailLen);
    const ty = cy + Math.sin(angle) * radius * (1 - tailLen) * aspect;

    const size = unit * (0.0016 + Math.pow(z, 1.9) * 0.0072) * (1 + burst * 0.55);
    const fade = Math.sin(clamp(rNorm / cycle) * Math.PI) ** 0.55; // 远处/尽头淡出
    const alpha = clamp((0.16 + z * 0.72) * fade * (0.55 + high * 0.32 + pulse * 0.3) * (0.42 + a5 * 0.58));
    if (alpha < 0.012) continue;
    const col = mixColor(mixColor(palette.secondary, palette.primary, a5), palette.accent, Math.pow(z, 1.6) * 0.72);

    const star: Star = { px, py, tx, ty, r: size, a: alpha, col };
    if (z > 0.55) near.push(star);
    else far.push(star);
  }

  const renderStar = (s: Star, i: number) => (
    <g key={`s-${i}`}>
      {trails > 0.03 && (
        <line
          x1={s.px}
          y1={s.py}
          x2={s.tx}
          y2={s.ty}
          stroke={withAlpha(s.col, s.a * 0.62 * trails)}
          strokeWidth={s.r * 1.1}
          strokeLinecap="round"
        />
      )}
      <circle cx={s.px} cy={s.py} r={s.r * 2.6} fill={withAlpha(s.col, s.a * 0.14)} />
      <circle cx={s.px} cy={s.py} r={s.r} fill={withAlpha(s.col, s.a)} />
    </g>
  );

  // 星云：几个缓慢漂移的柔光球
  const nebula = [0, 1, 2].map((i) => {
    const a = time * (0.05 + i * 0.028) + i * 2.4;
    const px = W * (0.5 + Math.cos(a) * (0.2 + i * 0.06) * (0.6 + depth));
    const py = H * (0.5 + Math.sin(a * 0.83 + i * 1.7) * (0.15 + i * 0.05) * (0.6 + depth));
    const r = unit * (0.34 + i * 0.12 + mid * 0.05);
    const col = mixColor(palette.primary, palette.secondary, 0.25 + i * 0.3 + sectionProgress * 0.15);
    return (
      <div
        key={`neb-${i}`}
        style={{
          position: "absolute",
          left: px - r,
          top: py - r,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${withAlpha(col, clamp(0.26 + mid * 0.18) * (0.4 + silenceGate * 0.85))} 0%, transparent 68%)`,
          filter: `blur(${unit * 0.06}px)`,
        }}
      />
    );
  });

  return (
    <div style={{ position: "absolute", inset: 0, background: palette.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(90% 80% at 50% 50%, ${mixColor(palette.background, palette.primary, 0.42)} 0%, ${palette.background} 72%)`,
        }}
      />
      {nebula}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="pf-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={unit * 0.0022} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g opacity={clamp(0.4 + silenceGate * 0.7)}>{far.map(renderStar)}</g>
        <g filter="url(#pf-glow)" opacity={clamp(0.45 + silenceGate * 0.65)}>
          {near.map(renderStar)}
        </g>
        {/* 瞬态冲击：从中心扩散的细环 */}
        {(pulse > 0.03 || onsetPulse > 0.03) && (
          <circle
            cx={cx}
            cy={cy}
            r={maxR * (0.1 + (1 - Math.max(pulse, onsetPulse)) * 0.72)}
            fill="none"
            stroke={withAlpha(palette.accent, Math.max(pulse, onsetPulse) * 0.22)}
            strokeWidth={unit * 0.0022}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(105% 100% at 50% 50%, transparent 42%, rgba(0,0,0,${clamp(0.44 + (1 - visual.backgroundBrightness) * 0.34)}) 100%)`,
        }}
      />
      <NoiseOverlay opacity={0.03} width={W} height={H} seed={visual.seed} />
    </div>
  );
};
