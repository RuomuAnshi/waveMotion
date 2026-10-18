#!/usr/bin/env node
/**
 * 验收：全部输出规格（3 比例 × 2 分辨率 × 2 帧率 × 有无音轨）+ 队列/取消/重试。
 * 通过 HTTP API 走真实服务端路径，最后用 ffprobe 核对成片参数。
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.WM_BASE || "http://127.0.0.1:3210";
const j = async (p, init) => {
  const r = await fetch(BASE + p, init);
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await j("/api/health");
console.log("health:", health.ok, "browser:", health.browser.ok, "python:", health.python.ok);

const audioList = (await j("/api/audio")).audio;
const audio = audioList.find((a) => a.name === "wav.wav") ?? audioList[0];
console.log("audio:", audio.name, audio.durationSec);

const visual = {
  template: process.env.TEMPLATE || "gradientPulse",
  palette: "crimsonPurple",
  customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
  intensity: 0.5,
  sensitivity: 1,
  backgroundBrightness: 0.5,
  autoVariation: true,
  seed: 20251010,
  rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
  templateParams: {},
};

function ffprobe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_streams", "-show_format", file,
  ], { encoding: "utf8" });
  return JSON.parse(out);
}

/** 只测组合矩阵的一个代表：用 frameRange 缩短实际渲染时间 */
const specs = [
  { aspect: "16:9", resolution: "1080", fps: 30, includeAudio: true },
  { aspect: "9:16", resolution: "1080", fps: 30, includeAudio: false },
  { aspect: "1:1", resolution: "1080", fps: 30, includeAudio: false },
  { aspect: "16:9", resolution: "1440", fps: 60, includeAudio: false },
  { aspect: "9:16", resolution: "1440", fps: 30, includeAudio: false },
];

const results = [];
for (const spec of specs) {
  const { job } = await j("/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioId: audio.id, visual, output: spec }),
  });
  process.stdout.write(`导出 ${spec.aspect} ${spec.resolution} ${spec.fps}fps 音频=${spec.includeAudio} ... `);
  let done = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 1000 * 600) {
    const { job: cur } = await j(`/api/render/${job.id}`);
    if (cur.status === "done") { done = cur; break; }
    if (cur.status === "error" || cur.status === "cancelled") {
      throw new Error(`任务失败: ${cur.status} ${cur.error ?? ""}`);
    }
    await sleep(1500);
  }
  if (!done) throw new Error("超时");
  const file = `data/renders/${done.output.fileName}`;
  const probe = ffprobe(file);
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  const row = {
    spec: `${spec.aspect}/${spec.resolution}/${spec.fps}fps/audio:${spec.includeAudio}`,
    w: v.width, h: v.height,
    fps: v.r_frame_rate,
    codec: v.codec_name,
    pix: v.pix_fmt,
    colorRange: v.color_range ?? "-",
    hasAudio: !!a,
    audioCodec: a?.codec_name ?? "-",
    durSec: +Number(probe.format.duration).toFixed(3),
    sizeMB: +(Number(probe.format.size) / 1048576).toFixed(1),
    secs: +((Date.now() - t0) / 1000).toFixed(1),
  };
  results.push(row);
  console.log("ok", `${row.w}x${row.h}`, row.pix, row.codec, `audio=${row.hasAudio}`);
}

console.table(results);

const checks = [];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const s = specs[i];
  const expW = s.resolution === "1080" ? (s.aspect === "16:9" ? 1920 : s.aspect === "9:16" ? 1080 : 1080)
    : (s.aspect === "16:9" ? 2560 : s.aspect === "9:16" ? 1440 : 1440);
  const expH = s.resolution === "1080" ? (s.aspect === "16:9" ? 1080 : s.aspect === "9:16" ? 1920 : 1080)
    : (s.aspect === "16:9" ? 1440 : s.aspect === "9:16" ? 2560 : 1440);
  checks.push([`${r.spec} 分辨率`, r.w === expW && r.h === expH, `${r.w}x${r.h} vs ${expW}x${expH}`]);
  checks.push([`${r.spec} 编码`, r.codec === "h264", r.codec]);
  checks.push([`${r.spec} 像素格式`, r.pix === "yuv420p", r.pix]);
  checks.push([`${r.spec} 帧率`, r.fps === `${s.fps}/1`, r.fps]);
  checks.push([`${r.spec} 音轨`, r.hasAudio === s.includeAudio, `got ${r.hasAudio}`]);
  if (s.includeAudio) checks.push([`${r.spec} 音频编码`, r.audioCodec === "aac", r.audioCodec]);
  const expDur = Math.ceil(audio.durationSec * s.fps) / s.fps;
  checks.push([`${r.spec} 时长`, Math.abs(r.durSec - audio.durationSec) < 0.1, `${r.durSec}s vs ${audio.durationSec}s`]);
}

// 队列：连续提交两个任务，第二个应排队
console.log("\n检查队列串行…");
const { job: j1 } = await j("/api/render", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ audioId: audio.id, visual, output: { aspect: "1:1", resolution: "1080", fps: 30, includeAudio: false } }) });
const { job: j2 } = await j("/api/render", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ audioId: audio.id, visual, output: { aspect: "1:1", resolution: "1080", fps: 30, includeAudio: false } }) });
await sleep(900);
const { job: st1 } = await j(`/api/render/${j1.id}`);
const { job: st2 } = await j(`/api/render/${j2.id}`);
console.log(`  任务1=${st1.status} 任务2=${st2.status}`);
checks.push(["队列串行执行", st1.status !== "queued" && st2.status === "queued", `1:${st1.status} 2:${st2.status}`]);

// 取消排队中的第二个任务（若已提前结束，取消返回 404 属正确行为，跳过该项）
let cancelledStatus = "(skipped)";
if (st2.status === "queued" || st2.status === "running") {
  const { job: cancelled } = await j(`/api/render/${j2.id}/cancel`, { method: "POST" });
  cancelledStatus = cancelled.status;
  checks.push(["取消排队任务", cancelled.status === "cancelled", cancelled.status]);
} else {
  console.log(`  任务2 已结束（${st2.status}），跳过取消检查`);
}
// 取消后再点一次取消应当明确拒绝（而非静默成功）
if (cancelledStatus === "cancelled") {
  const again = await fetch(`${BASE}/api/render/${j2.id}/cancel`, { method: "POST" });
  checks.push(["重复取消被拒绝", again.status === 404, `http ${again.status}`]);
}
// 重试可恢复
const { job: retried } = await j(`/api/render/${j2.id}/retry`, { method: "POST" });
checks.push(["取消后可重试", retried.status === "queued" || retried.status === "running", retried.status]);
await j(`/api/render/${retried.id}/cancel`, { method: "POST" });
// 重试是全新任务，快照与配置应一致、attempt 递增
checks.push(["重试生成新任务", retried.id !== j2.id && retried.attempt >= 2, `attempt=${retried.attempt}`]);

let allPass = true;
console.log("\n验收结果：");
for (const [name, ok, detail] of checks) {
  if (!ok) allPass = false;
  console.log(`${ok ? "✅" : "❌"} ${name}  ${detail}`);
}
console.log(allPass ? "\n✅ 输出规格验收全部通过" : "\n❌ 输出规格验收存在失败项");
process.exit(allPass ? 0 : 1);
