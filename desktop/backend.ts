import { buildServer } from "../server/index.ts";
import { renderQueue } from "../server/lib/renderQueue.ts";
import { stopChildProcesses } from "../server/lib/childProcesses.ts";

// Restore this after the macOS helper starts: dyld may remove loader variables
// from signed executables, while the bundled ffmpeg needs its sibling dylibs.
if (process.platform === "darwin" && process.env.WAVEMOTION_BINARIES_DIR) {
  process.env.DYLD_LIBRARY_PATH = process.env.WAVEMOTION_BINARIES_DIR;
}
const port = (process as typeof process & {parentPort?: {
  postMessage: (message: unknown) => void;
  on: (event: string, callback: (event: {data: {type: string}}) => void) => void;
}}).parentPort;
const send = (message: unknown) => port ? port.postMessage(message) : process.send?.(message);
const server = await buildServer();
server.addHook("onRequest", async (request, reply) => {
  const host = request.headers.host || "";
  if (!/^127\.0\.0\.1:\d+$/.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`)) {
    return reply.code(403).send({error: "仅允许应用本地访问"});
  }
});
server.addHook("onSend", async (_req, reply, payload) => {
  reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
  return payload;
});
const address = await server.listen({host: "127.0.0.1", port: 0});
send({type: "ready", url: address});
const shutdown = async () => {
  renderQueue.cancelPending();
  stopChildProcesses();
  // Let Remotion's cancellation finally-block close its Chromium process before
  // terminating this utility process. The main process still enforces a deadline.
  await renderQueue.waitForIdle();
  await server.close();
  process.exit(0);
};
port?.on("message", (event) => {if(event.data?.type === "shutdown")void shutdown();});
process.on("message", (message: {type?: string}) => {if(message?.type === "shutdown")void shutdown();});
process.on("SIGTERM", () => void shutdown());
