#!/usr/bin/env node
// 验收：项目配置保存 / 读取 / 导出 / 导入 / 删除 全链路。
import fs from "node:fs";
const BASE = process.env.WM_BASE || "http://127.0.0.1:3210";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};
async function j(p, opts) {
  const r = await fetch(BASE + p, opts);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}

const { body: audioBody } = await j("/api/audio");
const audio = audioBody.audio[0];

const visual = {
  template: "neonHalo", palette: "deepOcean",
  customColors: { background: "#020814", primary: "#0b3a6d", secondary: "#1660a8", accent: "#d9f2ff" },
  intensity: 0.72, sensitivity: 1.3, backgroundBrightness: 0.35, autoVariation: false, seed: 99,
  rhythm: { mode: "manual", bpm: 128, offsetSec: 0.125, rate: 2 },
  templateParams: { haloCount: 5, glow: 0.8 },
};
const output = { aspect: "9:16", resolution: "1440", fps: 60, includeAudio: false };
const project = { name: "验收项目 A", version: 1, audio: { audioId: audio.id, name: audio.name, durationSec: audio.durationSec }, visual, output };

// 1. 保存
const saved = await j("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
check("保存项目", saved.status === 200 && Boolean(saved.body.project?.id), `id=${saved.body.project?.id?.slice(0, 8)}`);
const id = saved.body.project.id;

// 2. 读取并核对全部字段（含嵌套参数）
const got = await j(`/api/projects/${id}`);
const p = got.body.project;
check("读取项目", got.status === 200 && p.id === id);
check("音频标识保留", p.audio.audioId === audio.id);
check("模板参数保留", p.visual.template === "neonHalo" && p.visual.templateParams.haloCount === 5);
check("节奏校正保留", p.visual.rhythm.mode === "manual" && p.visual.rhythm.bpm === 128 && p.visual.rhythm.offsetSec === 0.125 && p.visual.rhythm.rate === 2);
check("输出规格保留", p.output.aspect === "9:16" && p.output.resolution === "1440" && p.output.fps === 60 && p.output.includeAudio === false);
check("颜色保留", p.visual.customColors.accent === "#d9f2ff");

// 3. 覆盖保存（同 id 更新）
const updated = await j("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, name: "验收项目 A（改）", visual: { ...p.visual, intensity: 0.2 } }) });
check("覆盖保存同一项目", updated.status === 200 && updated.body.project.id === id);
const got2 = await j(`/api/projects/${id}`);
check("覆盖后字段生效", got2.body.project.name === "验收项目 A（改）" && got2.body.project.visual.intensity === 0.2);
check("createdAt 不被覆盖", got2.body.project.createdAt === p.createdAt);

// 4. 列表
const list = await j("/api/projects");
check("项目出现在列表", list.body.projects.some((x) => x.id === id), `共 ${list.body.projects.length} 个`);

// 5. 导出为 JSON 文件
const exported = await fetch(`${BASE}/api/projects/${id}/export`);
const expText = await exported.text();
const expJson = JSON.parse(expText);
check("导出 JSON", exported.status === 200 && expJson.id === id);
check("导出带附件头", (exported.headers.get("content-disposition") || "").includes("attachment"));

// 6. 导入（应生成新 id，不改动原项目）
const imported = await j("/api/projects/import", { method: "POST", headers: { "content-type": "application/json" }, body: expText });
const newId = imported.body.project?.id;
check("导入 JSON", imported.status === 200 && Boolean(newId));
check("导入生成新 id", newId !== id);
check("导入保留内容", imported.body.project.visual.template === "neonHalo" && imported.body.project.output.fps === 60);

// 7. 非法配置被拒绝
const bad = await j("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "无音频" }) });
check("缺少音频被拒绝", bad.status === 400, `http ${bad.status}`);

// 8. 读取不存在的项目
const missing = await j("/api/projects/does-not-exist");
check("不存在返回 404", missing.status === 404);

// 9. 删除
const del1 = await j(`/api/projects/${id}`, { method: "DELETE" });
const del2 = await j(`/api/projects/${newId}`, { method: "DELETE" });
check("删除项目", del1.status === 200 && del2.status === 200);
const gone = await j(`/api/projects/${id}`);
check("删除后读取 404", gone.status === 404);

console.log(`\n${fail === 0 ? "✅ 项目配置验收全部通过" : "❌ 项目配置验收存在失败项"}  (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);
