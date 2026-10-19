import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（server/lib -> ../../） */
export const ROOT_DIR = process.env.WAVEMOTION_ROOT_DIR
  ? path.resolve(process.env.WAVEMOTION_ROOT_DIR)
  : path.resolve(__dirname, "../..");

/** 运行时数据目录：分析缓存 / 导入素材 / 项目配置 / 成片，分开存放 */
export const DATA_DIR = process.env.WAVEMOTION_DATA_DIR
  ? path.resolve(process.env.WAVEMOTION_DATA_DIR)
  : path.join(ROOT_DIR, "data");

export const ANALYSIS_CACHE_DIR = path.join(DATA_DIR, "analysis");
export const IMPORTED_AUDIO_DIR = path.join(DATA_DIR, "audio");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const RENDERS_DIR = path.join(DATA_DIR, "renders");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
export const ASSETS_DIR = process.env.WAVEMOTION_ASSETS_DIR || path.join(ROOT_DIR, "assets");
export const WEB_DIST_DIR = process.env.WAVEMOTION_WEB_DIST || path.join(ROOT_DIR, "dist", "web");

export const PYTHON_SCRIPT = path.join(ROOT_DIR, "python", "analyze.py");
/** 隔离的 Python 环境（由 npm run setup:python 创建） */
export const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "bin", "python");
export const VENV_PYTHON_WIN = path.join(ROOT_DIR, ".venv", "Scripts", "python.exe");

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 启动时准备所有运行时目录 */
export function ensureAllDirs(): void {
  for (const dir of [ANALYSIS_CACHE_DIR, IMPORTED_AUDIO_DIR, PROJECTS_DIR, RENDERS_DIR, TMP_DIR]) {
    ensureDir(dir);
  }
}

/** 选择可用的 python 解释器：优先隔离环境，其次 PATH 中的 python3 */
export function resolvePython(): { bin: string; isolated: boolean } {
  const candidates = [
    process.env.WAVEMOTION_PYTHON,
    VENV_PYTHON,
    VENV_PYTHON_WIN,
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) return { bin, isolated: true };
    } catch {
      // ignore
    }
  }
  return { bin: "python3", isolated: false };
}

/** Desktop builds ship a frozen analyzer; source checkouts retain Python support. */
export function resolveAnalyzer(): { bin: string; args: string[]; isolated: boolean; bundled: boolean } {
  if (process.env.WAVEMOTION_ANALYZER) {
    return { bin: process.env.WAVEMOTION_ANALYZER, args: [], isolated: true, bundled: true };
  }
  const python = resolvePython();
  return { ...python, args: [PYTHON_SCRIPT], bundled: false };
}

/** 同目录写入临时文件再 rename，避免读到半个 JSON */
export function writeJsonAtomic(target: string, data: unknown): void {
  ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

export function readJson<T>(target: string): T | null {
  try {
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** 文件名安全化（保留中文，去掉路径分隔符与控制字符） */
export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\.\./g, "_")
    .trim()
    .slice(0, 120);
}

/** 生成不重复的文件名：base-<timestamp>-<rand>.ext */
export function uniqueFileName(base: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safeFileName(base)}-${stamp}-${rand}${ext.startsWith(".") ? ext : "." + ext}`;
}
