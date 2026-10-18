import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { listAudio, refreshAudioLibrary, getAudio, importAudio } from "../lib/audioLibrary.ts";
import { TMP_DIR, ensureDir } from "../lib/paths.ts";
import { probeMedia, isDecodableAudio } from "../lib/ffmpeg.ts";

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  /** 列出 assets 与已导入音频 */
  app.get("/api/audio", async (_req, reply) => {
    const entries = listAudio();
    return reply.send({ audio: entries });
  });

  /** 重新扫描音频库 */
  app.post("/api/audio/refresh", async (_req, reply) => {
    const entries = refreshAudioLibrary();
    return reply.send({ audio: entries });
  });

  /** 音频详情 */
  app.get<{ Params: { id: string } }>("/api/audio/:id", async (req, reply) => {
    const entry = getAudio(req.params.id);
    if (!entry) return reply.code(404).send({ error: "音频不存在" });
    return reply.send({ audio: entry });
  });

  /** 导入本地音频（multipart） */
  app.post("/api/audio/import", async (req: any, reply: any) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "未收到文件" });

    ensureDir(TMP_DIR);
    const tmpPath = path.join(TMP_DIR, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await pipeline(data.file, createWriteStream(tmpPath));

    try {
      if (!isDecodableAudio(tmpPath)) {
        throw new Error("无法解码该音频文件，请确认格式（支持 WAV/MP3/M4A/AAC/FLAC/OGG/OPUS/AIFF）");
      }
      const probe = probeMedia(tmpPath);
      const entry = importAudio(tmpPath, data.filename);
      return reply.send({ audio: entry, durationSec: probe.durationSec });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "导入失败" });
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  });

  /** 媒体读取地址（支持 Range，供播放器拖动） */
  app.get<{ Params: { id: string } }>("/api/audio/:id/media", async (req, reply: any) => {
    const audio = getAudio(req.params.id);
    if (!audio) return reply.code(404).send({ error: "音频不存在" });
    return reply.sendFile(path.basename(audio.path), path.dirname(audio.path));
  });
}
