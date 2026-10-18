// 验收脚本共用的环境解析：Chrome、Python、分析结果。
// 所有路径都从仓库位置推导或读环境变量，避免硬编码到某一台机器。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 找 Chrome：环境变量 → 常见安装位置 → 报错 */
export function resolveChrome() {
  const candidates = [
    process.env.WAVEMOTION_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("找不到 Chrome/Chromium，请用 WAVEMOTION_CHROME 指定可执行文件路径");
}

/** 找 Python：与服务端 resolvePython 相同顺序，最后退回 python3 */
export function resolvePython() {
  const venv = process.platform === "win32"
    ? path.join(ROOT, ".venv/Scripts/python.exe")
    : path.join(ROOT, ".venv/bin/python");
  const candidates = [process.env.WAVEMOTION_PYTHON, venv].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "python3";
}

/** 调 python/analyze.py 得到分析 JSON（写到临时目录） */
export function analyzeFile(inputPath, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    resolvePython(),
    [path.join(ROOT, "python/analyze.py"), "--input", inputPath, "--output", outPath],
    { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

/** 仓库里的示例音频（assets/ 不进版本库，缺失时给出清晰提示） */
export function sampleAudioPath() {
  const p = path.join(ROOT, "assets/wav.wav");
  if (!fs.existsSync(p)) {
    throw new Error("缺少 assets/wav.wav。验收脚本需要这个示例音频，请先把它放进 assets/");
  }
  return p;
}

/** 统一的检查计数器 */
export function createChecker() {
  const rows = [];
  return {
    check(name, ok, detail = "") {
      rows.push([name, ok, detail]);
      console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
      return ok;
    },
    get failed() {
      return rows.filter(([, ok]) => !ok);
    },
    summary() {
      const bad = rows.filter(([, ok]) => !ok);
      console.log(bad.length === 0 ? `\n✅ 全部通过（${rows.length} 项）` : `\n❌ ${bad.length}/${rows.length} 项失败`);
      process.exitCode = bad.length === 0 ? 0 : 1;
      return bad.length === 0;
    },
  };
}
