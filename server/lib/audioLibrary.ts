import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AudioEntry } from "../../src/shared/types.ts";
import {
  ASSETS_DIR,
  IMPORTED_AUDIO_DIR,
  ensureDir,
  safeFileName,
  uniqueFileName,
} from "./paths.ts";
import { probeMedia } from "./ffmpeg.ts";

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif", ".webm"]);

/** 由文件内容派生的稳定音频 id（切换音频后仍能命中缓存与项目配置） */
export function audioIdFor(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").slice(0, 24);
}

interface AudioRecord {
  id: string;
  name: string;
  path: string;
  source: "asset" | "import";
  sizeBytes: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  mtimeMs: number;
}

/** 内存索引：id -> 记录（启动时重建） */
const index = new Map<string, AudioRecord>();

function describe(filePath: string, source: "asset" | "import"): AudioRecord | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const id = audioIdFor(filePath);
    const probed = probeMedia(filePath);
    if (!probed.hasAudio) return null;
    return {
      id,
      name: path.basename(filePath),
      path: filePath,
      source,
      sizeBytes: stat.size,
      durationSec: probed.durationSec,
      sampleRate: probed.sampleRate,
      channels: probed.channels,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

/** 扫描 assets 与导入目录，重建索引 */
export function refreshAudioLibrary(): AudioEntry[] {
  index.clear();
  const dirs: Array<{ dir: string; source: "asset" | "import" }> = [
    { dir: ASSETS_DIR, source: "asset" },
    { dir: IMPORTED_AUDIO_DIR, source: "import" },
  ];
  for (const { dir, source } of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (name.startsWith("._") || name.startsWith(".")) continue;
      const ext = path.extname(name).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      const record = describe(path.join(dir, name), source);
      if (record) index.set(record.id, record);
    }
  }
  return listAudio();
}

export function listAudio(): AudioEntry[] {
  return [...index.values()]
    .sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === "asset" ? -1 : 1))
    .map(toEntry);
}

function toEntry(r: AudioRecord): AudioEntry {
  return {
    id: r.id,
    name: r.name,
    durationSec: r.durationSec,
    sampleRate: r.sampleRate,
    channels: r.channels,
    source: r.source,
    url: `/api/audio/${r.id}/media`,
    sizeBytes: r.sizeBytes,
  };
}

export function getAudio(id: string): AudioRecord | null {
  const found = index.get(id);
  if (found) return found;
  // 索引可能过期，尝试刷新一次
  refreshAudioLibrary();
  return index.get(id) ?? null;
}

export function getAudioPath(id: string): string | null {
  return getAudio(id)?.path ?? null;
}

/** 导入本地音频：复制进导入目录，保留原文件名（冲突时加后缀） */
export function importAudio(tmpFilePath: string, originalName: string): AudioEntry {
  ensureDir(IMPORTED_AUDIO_DIR);
  const base = safeFileName(path.parse(originalName).name || "audio");
  const ext = path.extname(originalName).toLowerCase() || ".wav";
  let target = path.join(IMPORTED_AUDIO_DIR, `${base}${ext}`);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(IMPORTED_AUDIO_DIR, `${base}-${counter}${ext}`);
    counter++;
  }
  fs.copyFileSync(tmpFilePath, target);
  const record = describe(target, "import");
  if (!record) {
    fs.unlinkSync(target);
    throw new Error("导入的音频无法解码，请确认文件格式");
  }
  index.set(record.id, record);
  return toEntry(record);
}

/** 唯一输出文件名（不覆盖已有成片） */
export function uniqueAudioName(base: string, ext: string): string {
  return uniqueFileName(base, ext);
}
