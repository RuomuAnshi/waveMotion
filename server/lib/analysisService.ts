import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AudioAnalysis } from "../../src/shared/types.ts";
import { ANALYSIS_VERSION } from "../../src/shared/types.ts";
import { VENV_PYTHON, VENV_PYTHON_WIN, PYTHON_SCRIPT, ANALYSIS_CACHE_DIR, TMP_DIR, ensureDir, readJson, resolvePython, writeJsonAtomic } from "./paths.ts";

export interface AnalysisResult {
  analysis: AudioAnalysis;
  cached: boolean;
}

/** 缓存 key：音频内容哈希 + 分析版本 */
export function analysisCacheKey(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  hash.update(`|${ANALYSIS_VERSION}`);
  return hash.digest("hex").slice(0, 40);
}

export function cachePathFor(key: string): string {
  return path.join(ANALYSIS_CACHE_DIR, `${key}.json`);
}

export function loadCachedAnalysis(filePath: string): AudioAnalysis | null {
  const key = analysisCacheKey(filePath);
  const cached = readJson<AudioAnalysis>(cachePathFor(key));
  if (cached && cached.analysisVersion === ANALYSIS_VERSION) {
    return { ...cached, audioId: key };
  }
  return null;
}

function debugEnv(): NodeJS.ProcessEnv {
  const py = resolvePython();
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    MPLBACKEND: "Agg",
    NUMBA_CACHE_DIR: path.join(TMP_DIR, "numba"),
    XDG_CACHE_HOME: path.join(TMP_DIR, "cache"),
    _PY: py.bin,
  };
}

export interface AnalyzeOptions {
  onProgress?: (progress: number, message?: string) => void;
  signal?: AbortSignal;
  /** 忽略缓存，强制重新分析 */
  force?: boolean;
}

/**
 * 调用 python 分析音频，写入缓存并返回结果。
 * 分析始终在降采样单声道副本上进行，不修改原始文件。
 */
export async function analyzeAudioFile(
  filePath: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  if (!options.force) {
    const cached = loadCachedAnalysis(filePath);
    if (cached) {
      options.onProgress?.(1, "命中分析缓存");
      return { analysis: cached, cached: true };
    }
  }
  const key = analysisCacheKey(filePath);
  const py = resolvePython();
  ensureDir(ANALYSIS_CACHE_DIR);
  ensureDir(TMP_DIR);
  const outPath = path.join(TMP_DIR, `analysis-${key}.json`);

  options.onProgress?.(0.05, "启动分析进程");
  const env = debugEnv();
  // 确保 python 子进程的临时目录可写（工作区是只读挂载时优先 /tmp）
  env.TMPDIR = env.TMPDIR || "/tmp";

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(py.bin, [PYTHON_SCRIPT, "--input", filePath, "--output", outPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: path.dirname(PYTHON_SCRIPT),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      const m = /(\d{1,3})%/.exec(String(d));
      if (m) options.onProgress?.(Math.min(0.9, Number(m[1]) / 100));
    });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    options.signal?.addEventListener("abort", () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    });
  });

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(explainAnalysisError(detail, py.bin, py.isolated));
  }

  const analysis = readJson<AudioAnalysis>(outPath);
  if (!analysis || !Array.isArray(analysis.rms)) {
    throw new Error("分析进程未产出有效结果，请检查 Python 环境");
  }
  analysis.analysisVersion = ANALYSIS_VERSION;
  analysis.audioId = key;
  writeJsonAtomic(cachePathFor(key), analysis);
  try {
    fs.unlinkSync(outPath);
  } catch {
    // ignore
  }
  options.onProgress?.(1, "分析完成");
  return { analysis, cached: false };
}

/** 把 python 的报错翻译成用户能看懂的中文提示 */
function explainAnalysisError(detail: string, pythonBin: string, isolated: boolean): string {
  const text = detail.slice(-4000);
  if (/未找到 FFmpeg|未找到 FFprobe/.test(text)) {
    return "缺少音频解码工具，请安装 FFmpeg/FFprobe，或设置 WAVEMOTION_FFMPEG 和 WAVEMOTION_FFPROBE 指向可执行文件。";
  }
  if (/ModuleNotFoundError|No module named 'librosa'/.test(text)) {
    return `音频分析依赖未安装。请运行 npm run setup:python 创建隔离环境（当前解释器：${pythonBin}${isolated ? "" : "，未找到 .venv"}）。`;
  }
  if (/文件不存在/.test(text)) return "找不到音频文件，可能已被移动或删除";
  if (/无法读取音频|解码失败|Invalid data|failed to load|Error opening/.test(text)) {
    return "音频文件无法解码，可能已损坏或格式不受支持";
  }
  if (/音频时长过短/.test(text)) return "音频时长过短（不足 0.05 秒），无法分析";
  const tail = text.split("\n").filter(Boolean).slice(-3).join(" | ");
  return `音频分析失败：${tail || "未知错误"}`;
}

/** 检查 python 环境是否就绪 */
export async function checkPythonEnvironment(): Promise<{ ok: boolean; bin: string; message: string }> {
  const py = resolvePython();
  const exists = fs.existsSync(VENV_PYTHON) || fs.existsSync(VENV_PYTHON_WIN);
  return new Promise((resolve) => {
    const child = spawn(py.bin, ["-c", "import librosa, numpy, soundfile; print('ok')"], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => resolve({ ok: false, bin: py.bin, message: `无法启动 Python（${py.bin}）：${e.message}` }));
    child.on("close", (code) => {
      if (code === 0 && out.includes("ok")) {
        resolve({ ok: true, bin: py.bin, message: `Python 环境就绪（${py.bin}）` });
      } else if (!exists) {
        resolve({
          ok: false,
          bin: py.bin,
          message: "未找到隔离的 Python 环境，请先运行 npm run setup:python",
        });
      } else {
        resolve({ ok: false, bin: py.bin, message: `Python 依赖检查失败：${(err || out).trim().slice(-300)}` });
      }
    });
  });
}
