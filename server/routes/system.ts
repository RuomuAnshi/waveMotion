import type { FastifyInstance } from "fastify";
import { resolveBrowser } from "../lib/renderService.ts";
import { checkPythonEnvironment } from "../lib/analysisService.ts";
import { resolveFfmpegBin, resolveFfprobeBin } from "../lib/ffmpeg.ts";
import { renderQueue } from "../lib/renderQueue.ts";
import { ANALYSIS_VERSION } from "../../src/shared/types.ts";

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_req, reply) => {
    const python = await checkPythonEnvironment();
    const browser = resolveBrowser();
    const jobs = renderQueue.list();
    return reply.send({
      ok: python.ok && Boolean(browser),
      version: ANALYSIS_VERSION,
      python,
      browser: { path: browser, ok: Boolean(browser) },
      ffmpeg: { path: resolveFfmpegBin(), ffprobe: resolveFfprobeBin() },
      queue: {
        total: jobs.length,
        running: jobs.filter((j) => j.status === "running").length,
        queued: jobs.filter((j) => j.status === "queued").length,
      },
    });
  });
}
