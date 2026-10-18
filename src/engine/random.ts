/**
 * 确定性随机：所有随机性都来自固定种子 + 明确输入（帧号 / 索引 / 拍号），
 * 因此直接跳转到任意帧也能得到相同结果（Remotion 确定性渲染要求）。
 */

/** mulberry32 PRNG：给定 seeds 返回 [0,1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 二维整数哈希 -> [0,1)，用于 (seed, index) 组合 */
export function hash2(seed: number, index: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(index + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 三维哈希，用于 (seed, a, b) */
export function hash3(seed: number, a: number, b: number): number {
  return hash2(hash2(seed, a) * 4294967296, b);
}

/** 由种子+索引派生的稳定浮点数 */
export function seededRange(seed: number, index: number, min: number, max: number): number {
  return min + (max - min) * hash2(seed, index);
}

/** 由种子派生的稳定随机数组 */
export function seededArray(seed: number, count: number, min = 0, max = 1): number[] {
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = seededRange(seed, i, min, max);
  return out;
}

/** 稳定的平滑噪声：用于轮廓抖动等连续变化 */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(seed, xi * 73856093 ^ (yi * 19349663));
  const b = hash2(seed, (xi + 1) * 73856093 ^ (yi * 19349663));
  const c = hash2(seed, xi * 73856093 ^ ((yi + 1) * 19349663));
  const d = hash2(seed, (xi + 1) * 73856093 ^ ((yi + 1) * 19349663));
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function mixHex(a: string, b: string, t: number): string {
  return mixColor(a, b, t);
}

/** 十六进制颜色混合，t=0 返回 a，t=1 返回 b */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = clamp(t);
  return toHex(
    Math.round(lerp(ca[0], cb[0], k)),
    Math.round(lerp(ca[1], cb[1], k)),
    Math.round(lerp(ca[2], cb[2], k)),
  );
}

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp(alpha)})`;
}

/** 亮度调整，amount > 0 变亮、< 0 变暗 */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  if (amount >= 0) return toHex(lerp(r, 255, amount), lerp(g, 255, amount), lerp(b, 255, amount));
  return toHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}
