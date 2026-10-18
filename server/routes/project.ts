import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PROJECTS_DIR, ensureDir, writeJsonAtomic, readJson, safeFileName } from "../lib/paths.ts";
import type { ProjectConfig } from "../../src/shared/types.ts";

const PROJECT_VERSION = 1;

function projectPath(id: string): string {
  return path.join(PROJECTS_DIR, `${safeFileName(id)}.json`);
}

function validateProject(input: unknown): ProjectConfig {
  const p = input as Partial<ProjectConfig> | null;
  if (!p || typeof p !== "object") throw new Error("项目配置格式不正确");
  if (!p.audio || typeof p.audio.audioId !== "string") throw new Error("项目配置缺少音频信息");
  if (!p.visual || typeof p.visual.template !== "string") throw new Error("项目配置缺少模板信息");
  if (!p.output || typeof p.output.aspect !== "string") throw new Error("项目配置缺少输出规格");
  return {
    id: p.id,
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "未命名项目",
    version: typeof p.version === "number" ? p.version : PROJECT_VERSION,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    audio: {
      audioId: p.audio.audioId,
      name: typeof p.audio.name === "string" ? p.audio.name : p.audio.audioId,
      durationSec: typeof p.audio.durationSec === "number" ? p.audio.durationSec : 0,
    },
    visual: p.visual,
    output: p.output,
  };
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  /** 列出已保存项目 */
  app.get("/api/projects", async (_req, reply) => {
    ensureDir(PROJECTS_DIR);
    const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("._"));
    const projects = files
      .map((file) => readJson<ProjectConfig>(path.join(PROJECTS_DIR, file)))
      .filter((p): p is ProjectConfig => Boolean(p))
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return reply.send({ projects });
  });

  /** 保存项目（新建或覆盖） */
  app.post<{ Body: ProjectConfig }>("/api/projects", async (req, reply) => {
    let project: ProjectConfig;
    try {
      project = validateProject(req.body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "项目配置无效" });
    }
    ensureDir(PROJECTS_DIR);
    const now = new Date().toISOString();
    if (!project.id) project.id = crypto.randomUUID();
    const existing = readJson<ProjectConfig>(projectPath(project.id));
    project.createdAt = existing?.createdAt ?? project.createdAt ?? now;
    project.updatedAt = now;
    project.version = PROJECT_VERSION;
    writeJsonAtomic(projectPath(project.id), project);
    return reply.send({ project });
  });

  /** 读取项目 */
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = readJson<ProjectConfig>(projectPath(req.params.id));
    if (!project) return reply.code(404).send({ error: "项目不存在" });
    return reply.send({ project });
  });

  /** 删除项目 */
  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const file = projectPath(req.params.id);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "项目不存在" });
    fs.unlinkSync(file);
    return reply.send({ ok: true });
  });

  /** 导出项目 JSON（浏览器下载） */
  app.get<{ Params: { id: string } }>("/api/projects/:id/export", async (req, reply) => {
    const project = readJson<ProjectConfig>(projectPath(req.params.id));
    if (!project) return reply.code(404).send({ error: "项目不存在" });
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(project.name)}.wavemotion.json"`);
    return reply.send(project);
  });

  /** 导入项目 JSON */
  app.post<{ Body: ProjectConfig }>("/api/projects/import", async (req, reply) => {
    let project: ProjectConfig;
    try {
      project = validateProject(req.body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "项目文件格式不正确" });
    }
    ensureDir(PROJECTS_DIR);
    delete project.id;
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: project,
    });
    return reply.send(created.json());
  });
}
