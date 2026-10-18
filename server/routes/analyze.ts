import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { getAudio, getAudioPath } from "../lib/audioLibrary.ts";
import { analyzeAudioFile, loadCachedAnalysis, checkPythonEnvironment } from "../lib/analysisService.ts";

interface AnalyzeRequest {
  audioId?: string;
  force?: boolean;
}

export async function registerAnalyzeRoutes(app: FastifyInstance): Promise<void> {
  /** 分析环境自检（Python + librosa） */
  app.get("/api/analyze/health", async (_req, reply) => {
    const env = await checkPythonEnvironment();
    return reply.send({ environment: env });
  });

  /** 查询缓存结果（不触发分析） */
  app.get<{ Params: { audioId: string } }>("/api/analyze/cache/:audioId", async (req, reply) => {
    const audioPath = getAudioPath(req.params.audioId);
    if (!audioPath) return reply.code(404).send({ error: "音频不存在" });
    if (!fs.existsSync(audioPath)) return reply.code(404).send({ error: "音频文件已丢失" });
    const cached = loadCachedAnalysis(audioPath);
    if (!cached) return reply.code(404).send({ error: "尚无分析缓存", cached: false });
    const entry = getAudio(req.params.audioId);
    return reply.send({ analysis: { ...cached, audioId: req.params.audioId }, cached: true, audio: entry });
  });

  /**
   * 创建分析（同步执行，前端显示进度动画）。
   * 分析通常几秒完成；缓存命中时立即返回以便切换模板不改动分析结果。
   */
  app.post<{ Body: AnalyzeRequest }>("/api/analyze", async (req, reply) => {
    const body = req.body ?? {};
    const audioId = body.audioId;
    if (!audioId) return reply.code(400).send({ error: "缺少 audioId" });

    const audioPath = getAudioPath(audioId);
    if (!audioPath) return reply.code(404).send({ error: "音频不存在" });
    if (!fs.existsSync(audioPath)) return reply.code(404).send({ error: "音频文件已丢失，请重新导入" });

    try {
      const { analysis, cached } = await analyzeAudioFile(audioPath, { force: body.force === true });
      return reply.send({ analysis: { ...analysis, audioId }, cached });
    } catch (err) {
      const message = err instanceof Error ? err.message : "分析失败";
      return reply.code(500).send({ error: message });
    }
  });
}
