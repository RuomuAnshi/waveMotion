import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

/** 定位 ffmpeg / ffprobe：环境变量 > PATH */
export function resolveFfmpegBin(): string {
  return process.env.WAVEMOTION_FFMPEG || "ffmpeg";
}
export function resolveFfprobeBin(): string {
  return process.env.WAVEMOTION_FFPROBE || "ffprobe";
}

export interface ProbeResult {
  durationSec: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bitRate?: number;
  formatName?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  videoWidth?: number;
  videoHeight?: number;
  videoFps?: number;
  nbFrames?: number;
}

/** 用 ffprobe 读取媒体信息 */
export function probeMedia(filePath: string): ProbeResult {
  const bin = resolveFfprobeBin();
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  const result = spawnSync(bin, args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`无法运行 ffprobe (${bin}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe 解析失败: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("ffprobe 输出无法解析为 JSON");
  }
  const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
  const audio = streams.find((s) => s.codec_type === "audio");
  const video = streams.find((s) => s.codec_type === "video");
  const format = parsed.format ?? {};
  const duration = Number(format.duration ?? audio?.duration ?? video?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("无法读取媒体时长，文件可能已损坏");
  }
  let videoFps: number | undefined;
  if (video?.r_frame_rate && video.r_frame_rate !== "0/0") {
    const [n, d] = String(video.r_frame_rate).split("/").map(Number);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) videoFps = n / d;
  }
  return {
    durationSec: duration,
    sampleRate: Number(audio?.sample_rate ?? 0) || 0,
    channels: Number(audio?.channels ?? 0) || 0,
    codec: String(audio?.codec_name ?? video?.codec_name ?? "unknown"),
    bitRate: format.bit_rate ? Number(format.bit_rate) : undefined,
    formatName: format.format_name,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoWidth: video?.width,
    videoHeight: video?.height,
    videoFps,
    nbFrames: video?.nb_frames ? Number(video.nb_frames) : undefined,
  };
}

export interface FfprobeStreamInfo {
  codecName: string;
  width?: number;
  height?: number;
  fps?: number;
  pixFmt?: string;
  sampleRate?: number;
  channels?: number;
  durationSec: number;
  nbFrames?: number;
}

export interface FfprobeVerifyResult {
  video: FfprobeStreamInfo | null;
  audio: FfprobeStreamInfo | null;
  container: string;
  durationSec: number;
  ok: boolean;
  problems: string[];
}

/** 用 ffprobe 核对导出成片规格 */
interface VerifyExpectation {
  /** 期望包含音轨（AAC） */
  expectAudio?: boolean;
  /** 期望不含音轨 */
  expectNoAudio?: boolean;
  /** 期望时长（秒），超过该容差则报错 */
  expectedDurationSec?: number;
  durationToleranceSec?: number;
}

export function verifyRender(filePath: string, expect: VerifyExpectation = {}): FfprobeVerifyResult {
  const bin = resolveFfprobeBin();
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath];
  const result = spawnSync(bin, args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
  const problems: string[] = [];
  if (result.error || result.status !== 0) {
    return {
      video: null,
      audio: null,
      container: "",
      durationSec: 0,
      ok: false,
      problems: [result.error?.message ?? `ffprobe exit ${result.status}`],
    };
  }
  const parsed = JSON.parse(result.stdout);
  const streams: any[] = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const formatDuration = Number(parsed.format?.duration ?? 0);

  const fpsOf = (raw: string | undefined): number | undefined => {
    if (!raw || raw === "0/0") return undefined;
    const [n, d] = String(raw).split("/").map(Number);
    return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : undefined;
  };

  const video: FfprobeStreamInfo | null = v
    ? {
        codecName: v.codec_name,
        width: v.width,
        height: v.height,
        fps: fpsOf(v.r_frame_rate),
        pixFmt: v.pix_fmt,
        durationSec: Number(v.duration ?? formatDuration),
        nbFrames: v.nb_frames ? Number(v.nb_frames) : undefined,
      }
    : null;
  const audio: FfprobeStreamInfo | null = a
    ? {
        codecName: a.codec_name,
        sampleRate: Number(a.sample_rate),
        channels: a.channels,
        durationSec: Number(a.duration ?? formatDuration),
      }
    : null;

  if (!video) problems.push("缺少视频流");
  else {
    if (video.codecName !== "h264") problems.push(`视频编码为 ${video.codecName}，期望 h264`);
    if (video.pixFmt && video.pixFmt !== "yuv420p") problems.push(`像素格式为 ${video.pixFmt}，期望 yuv420p`);
  }

  if (expect.expectAudio) {
    if (!audio) problems.push("缺少音轨，期望保留原音频（AAC）");
    else if (audio.codecName !== "aac") problems.push(`音频编码为 ${audio.codecName}，期望 aac`);
  }
  if (expect.expectNoAudio && audio) {
    problems.push(`期望仅画面，但成片包含音轨（${audio.codecName}）`);
  }

  const duration = formatDuration || Number(video?.durationSec ?? 0);
  if (expect.expectedDurationSec !== undefined && expect.expectedDurationSec > 0) {
    const tol = expect.durationToleranceSec ?? 0.1;
    if (Math.abs(duration - expect.expectedDurationSec) > tol) {
      problems.push(
        `时长 ${duration.toFixed(3)}s 与期望 ${expect.expectedDurationSec.toFixed(3)}s 相差超过 ${tol}s`,
      );
    }
  }
  return {
    video,
    audio,
    container: String(parsed.format?.format_name ?? ""),
    durationSec: formatDuration || Number(video?.durationSec ?? 0),
    ok: problems.length === 0,
    problems,
  };
}

/** 把音频的时长信息用 ffprobe 读取失败时的兜底：用 ffmpeg 解码统计 */
export function probeAudioViaDecode(filePath: string): number {
  const bin = resolveFfmpegBin();
  const result = spawnSync(bin, ["-v", "error", "-i", filePath, "-f", "null", "-"], {
    encoding: "utf-8",
  });
  // ffmpeg 输出 Time: 00:00:17.07
  const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(result.stderr || "");
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** 可选：检查文件是否是可解码音频 */
export function isDecodableAudio(filePath: string): boolean {
  try {
    const info = probeMedia(filePath);
    return info.hasAudio && info.durationSec > 0;
  } catch {
    return false;
  }
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 异步执行 ffmpeg，用于导出时封装音轨 */
export function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const bin = resolveFfmpegBin();
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on("error", (err) => resolve({ code: -1, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** 整片画面完整性扫描结果 */
export interface FrameIntegrityResult {
  frames: number;
  /** 损坏帧号（1 起） */
  corrupt: number[];
  /** 最大纯黑像素占比（仅作诊断；正常黑底画面也可能接近 1） */
  maxBlackRatio: number;
  medianBlackRatio: number;
  /** 与上下镜像位置不匹配的近全黑水平行占比；圆盘外的对称黑底不算损坏 */
  maxMissingRowRatio: number;
}

/**
 * 逐帧扫描「画面缺条带」损坏。
 *
 * 某些 GPU 光栅化路径（macOS 无头 Chrome 的 egl / angle-egl）会静默只画出顶部
 * 若干水平条带、其余纯黑。此时单帧尺寸、ffprobe 的分辨率/帧率/帧数/时长、
 * 甚至 ffmpeg 解码全部正常。纯黑像素比例只能筛出候选帧，不能直接判坏：
 * 黑底圆盘和竖屏留黑本来就有大面积黑色。再检查近全黑水平行是否与上下
 * 镜像位置显著不一致，区分正常的对称黑底与单侧缺失的水平条带。
 *
 * 用 ffmpeg 缩到 640x360 输出 rawvideo，边流边算：内存恒定（只缓冲一帧），
 * 不随视频长度增长。
 */
export function scanFrameIntegrity(
  filePath: string,
  options: {
    blackRatioLimit?: number;
    width?: number;
    height?: number;
    /** 超过这个秒数就放弃，避免异常输入把服务卡死 */
    timeoutMs?: number;
  } = {},
): Promise<FrameIntegrityResult> {
  const bin = resolveFfmpegBin();
  const width = options.width ?? 640;
  const height = options.height ?? 360;
  const limit = options.blackRatioLimit ?? 0.1;
  const frameBytes = width * height * 3;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        "-v", "error",
        "-i", filePath,
        "-vf", `scale=${width}:${height}:flags=area,format=rgb24`,
        "-f", "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const ratios: number[] = [];
    const corrupt: number[] = [];
    let maxMissingRowRatio = 0;
    let pending: Buffer = Buffer.alloc(0);
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`扫描成片画面完整性超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) return reject(err);
      const sorted = [...ratios].sort((a, b) => a - b);
      resolve({
        frames: ratios.length,
        corrupt,
        maxBlackRatio: ratios.length ? Math.max(...ratios) : 0,
        medianBlackRatio: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0,
        maxMissingRowRatio,
      });
    };

    const consume = (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (pending.length - offset >= frameBytes) {
        let black = 0;
        const blackByRow = new Uint32Array(height);
        for (let p = offset; p < offset + frameBytes; p += 3) {
          if (pending[p]! <= 1 && pending[p + 1]! <= 1 && pending[p + 2]! <= 1) {
            black++;
            blackByRow[Math.floor((p - offset) / (width * 3))]++;
          }
        }
        const ratio = black / (width * height);
        ratios.push(ratio);
        let missingRows = 0;
        if (ratio > limit) {
          for (let y = 0; y < height; y++) {
            if (blackByRow[y]! / width >= 0.98 && blackByRow[height - 1 - y]! / width < 0.9) missingRows++;
          }
        }
        const missingRowRatio = missingRows / height;
        maxMissingRowRatio = Math.max(maxMissingRowRatio, missingRowRatio);
        if (missingRowRatio > 0.08) corrupt.push(ratios.length);
        offset += frameBytes;
      }
      pending = offset ? pending.subarray(offset) : pending;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        consume(chunk);
      } catch (err) {
        child.kill("SIGKILL");
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 32_000) stderr = stderr.slice(-16_000);
    });
    child.on("error", (err) => finish(new Error(`无法扫描成片画面完整性：${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0 || ratios.length === 0 || pending.length !== 0) {
        return finish(new Error(`扫描成片画面完整性失败：${stderr.trim().split("\n").slice(-1)[0] ?? `ffmpeg 退出码 ${code}`}`));
      }
      finish(null);
    });
  });
}
