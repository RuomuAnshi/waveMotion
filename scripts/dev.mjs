#!/usr/bin/env node
// 同时启动 Vite 前端与 Fastify 本地服务，任一退出则整体退出。
// 不依赖 concurrently 之类的额外包。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const children = [];

function run(label, color, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
  });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m`;
  const pipe = (stream, out) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(`${prefix} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`${prefix} 已退出（${signal ?? code}），正在关闭其余进程…`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 400);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("\x1b[36m[dev]\x1b[0m 启动 WaveMotion 开发环境…");
run("server", "35", npx, ["tsx", "server/index.ts"], { NODE_ENV: "development" });
run("web", "36", npx, ["vite"]);
