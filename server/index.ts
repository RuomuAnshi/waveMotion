import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { ensureAllDirs, RENDERS_DIR, IMPORTED_AUDIO_DIR, ASSETS_DIR, WEB_DIST_DIR, ROOT_DIR } from "./lib/paths.ts";
import { refreshAudioLibrary } from "./lib/audioLibrary.ts";
import { registerAudioRoutes } from "./routes/audio.ts";
import { registerAnalyzeRoutes } from "./routes/analyze.ts";
import { registerRenderRoutes, bindRenderExecutor } from "./routes/render.ts";
import { registerProjectRoutes } from "./routes/project.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { warmUpBrowser } from "./lib/renderService.ts";

const HOST = process.env.WAVEMOTION_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WAVEMOTION_PORT ?? 3210);
const IS_DEV = process.env.NODE_ENV !== "production";
const DEV_WEB_PORT = Number(process.env.WAVEMOTION_WEB_PORT ?? 5179);

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.WAVEMOTION_LOG_LEVEL ?? "info" },
    bodyLimit: 64 * 1024 * 1024,
  });

  await app.register(multipart, {
    limits: { fileSize: 512 * 1024 * 1024, files: 1 },
  });

  ensureAllDirs();
  refreshAudioLibrary();
  bindRenderExecutor();

  // 成片下载/预览：只暴露 renders 目录
  await app.register(fastifyStatic, {
    root: RENDERS_DIR,
    prefix: "/renders/",
    decorateReply: true,
  });

  // 音频媒体读取：assets（内置素材）与导入目录
  await app.register(fastifyStatic, {
    root: ASSETS_DIR,
    prefix: "/media/assets/",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: IMPORTED_AUDIO_DIR,
    prefix: "/media/imported/",
    decorateReply: false,
    setHeaders: (res: any) => {
      res.setHeader("Cache-Control", "no-cache");
    },
  });

  await registerSystemRoutes(app);
  await registerAudioRoutes(app);
  await registerAnalyzeRoutes(app);
  await registerRenderRoutes(app);
  await registerProjectRoutes(app);

  app.setErrorHandler((err: any, _req, reply) => {
    app.log.error(err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: err?.message || "服务器内部错误" });
  });

  // 生产模式：托管已构建的前端；开发模式由 Vite 提供
  const distIndex = path.join(WEB_DIST_DIR, "index.html");
  if (!IS_DEV && fs.existsSync(distIndex)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST_DIR,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/renders/") || req.url.startsWith("/media/")) {
        return reply.code(404).send({ error: "接口不存在" });
      }
      return reply.sendFile("index.html");
    });
  } else if (!IS_DEV) {
    app.get("/", async (_req, reply) => {
      reply.type("text/html; charset=utf-8");
      return reply.send(
        `<!doctype html><meta charset="utf-8"><title>WaveMotion</title>` +
          `<body style="font-family:system-ui;background:#12101a;color:#eee;padding:40px">` +
          `<h1>WaveMotion 服务已启动</h1>` +
          `<p>前端尚未构建。开发模式请运行 <code>npm run dev</code>，或先执行 <code>npm run build</code>。</p>` +
          `<p>开发界面地址：<a style="color:#9cf" href="http://127.0.0.1:${DEV_WEB_PORT}">http://127.0.0.1:${DEV_WEB_PORT}</a></p>`,
      );
    });
  }

  return app;
}

async function main() {
  ensureAllDirs();
  const app = await buildServer();
  await app.listen({ host: HOST, port: PORT });

  const webUrl = IS_DEV ? `http://${HOST}:${DEV_WEB_PORT}` : `http://${HOST}:${PORT}`;
  app.log.info(`WaveMotion 服务已启动: http://${HOST}:${PORT}`);
  app.log.info(`界面地址: ${webUrl}（工作目录 ${ROOT_DIR}）`);

  // 后台预热浏览器（不阻塞启动）
  void warmUpBrowser();

  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，正在关闭服务…`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

const isDirectRun = process.argv[1] && /server\/index\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun || process.env.WAVEMOTION_AUTOSTART === "1") {
  main().catch((err) => {
    console.error("服务启动失败:", err);
    process.exit(1);
  });
}
