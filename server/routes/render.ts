import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { renderQueue } from "../lib/renderQueue.ts";
import type { RenderTaskInput } from "../lib/renderQueue.ts";
import { getAudio, getAudioPath } from "../lib/audioLibrary.ts";
import { analyzeAudioFile } from "../lib/analysisService.ts";
import { executeRender } from "../lib/renderService.ts";
import { RENDERS_DIR } from "../lib/paths.ts";
import type { OutputConfig, VisualConfig } from "../../src/shared/types.ts";
import { DEFAULT_VISUAL } from "../../src/shared/constants.ts";
import { probeMedia } from "../lib/ffmpeg.ts";

interface CreateRenderBody {
  audioId?: string;
  visual?: VisualConfig;
  output?: OutputConfig;
}

function validateVisual(visual: unknown): VisualConfig {
  const v = (visual ?? {}) as Partial<VisualConfig>;
  return {
    ...DEFAULT_VISUAL,
    ...v,
    customColors: { ...DEFAULT_VISUAL.customColors, ...(v.customColors ?? {}) },
    rhythm: { ...DEFAULT_VISUAL.rhythm, ...(v.rhythm ?? {}) },
    templateParams: { ...(v.templateParams ?? {}) },
  };
}

function validateOutput(output: unknown): OutputConfig {
  const o = (output ?? {}) as Partial<OutputConfig>;
  const aspect = o.aspect === "9:16" || o.aspect === "1:1" ? o.aspect : "16:9";
  const resolution = o.resolution === "1440" ? "1440" : "1080";
  const fps = o.fps === 60 ? 60 : 30;
  return { aspect, resolution, fps, includeAudio: o.includeAudio !== false };
}

export async function registerRenderRoutes(app: FastifyInstance): Promise<void> {
  /** 提交导出任务 */
  app.post<{ Body: CreateRenderBody }>("/api/render", async (req, reply) => {
    const body = req.body ?? {};
    const audioId = body.audioId;
    if (!audioId) return reply.code(400).send({ error: "缺少 audioId" });

    const entry = getAudio(audioId);
    const audioPath = getAudioPath(audioId);
    if (!entry || !audioPath || !fs.existsSync(audioPath)) {
      return reply.code(404).send({ error: "音频不存在或文件已丢失" });
    }

    let analysis;
    try {
      const result = await analyzeAudioFile(audioPath);
      analysis = { ...result.analysis, audioId };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "分析失败，无法导出" });
    }

    // 时长按音频样本数计算（以 ffprobe 为准，和播放器保持一致）
    let durationSec = analysis.durationSec;
    try {
      const probe = probeMedia(audioPath);
      if (probe.durationSec > 0) durationSec = probe.durationSec;
    } catch {
      // 退回分析时长
    }

    const visual = validateVisual(body.visual);
    const output = validateOutput(body.output);

    const input: RenderTaskInput = {
      audioId,
      audioPath,
      audioName: entry.name,
      analysis,
      visual,
      output,
      durationSec,
    };

    const job = renderQueue.create(input);
    return reply.send({ job });
  });

  /** 任务列表 */
  app.get("/api/render", async (_req, reply) => {
    return reply.send({ jobs: renderQueue.list() });
  });

  /** 单个任务状态 */
  app.get<{ Params: { id: string } }>("/api/render/:id", async (req, reply) => {
    const job = renderQueue.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "任务不存在" });
    return reply.send({ job });
  });

  /** 取消任务 */
  app.post<{ Params: { id: string } }>("/api/render/:id/cancel", async (req, reply) => {
    const ok = renderQueue.cancel(req.params.id);
    if (!ok) return reply.code(404).send({ error: "任务不存在或已结束，无法取消" });
    return reply.send({ job: renderQueue.get(req.params.id) });
  });

  /** 重试失败/取消的任务 */
  app.post<{ Params: { id: string } }>("/api/render/:id/retry", async (req, reply) => {
    const job = renderQueue.retry(req.params.id);
    if (!job) return reply.code(400).send({ error: "只有失败或已取消的任务可以重试" });
    return reply.send({ job });
  });

  /** 清理已结束任务记录 */
  app.post("/api/render/clear-finished", async (_req, reply) => {
    const removed = renderQueue.clearFinished();
    return reply.send({ removed });
  });

  /** 下载成片（支持 Range） */
  app.get<{ Params: { fileName: string } }>("/api/download/:fileName", async (req, reply: any) => {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.join(RENDERS_DIR, fileName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "成片不存在" });
    return reply.sendFile(fileName, RENDERS_DIR);
  });
}

/** 把真实渲染器接进队列（在服务启动时调用一次） */
export function bindRenderExecutor(): void {
  renderQueue.configure({
    render: async (job, ctx) => {
      const audioPath = getAudioPath(job.snapshot.audioId) ?? job.snapshot.audioPath;
      let analysis;
      try {
        const result = await analyzeAudioFile(audioPath);
        analysis = { ...result.analysis, audioId: job.snapshot.audioId };
      } catch (err) {
        throw new Error(`读取分析数据失败：${err instanceof Error ? err.message : String(err)}`);
      }
      const output = await executeRender({
        analysis,
        job,
        onProgress: ctx.report,
        onCancel: ctx.onCancel,
        isCancelled: ctx.isCancelled,
      });
      if (output) job.output = output;
    },
    onUpdate: () => {
      // 队列自身负责持久化；此处保留给 WebSocket / SSE 扩展
    },
  });
}
