/**
 * 渲染自检：用真实 Composition 渲染一小段并核对输出规格。
 *
 * 用法：npm run verify:render [-- --template gradientPulse --frames 60]
 * 校验分辨率 / 帧率 / 时长 / H.264 / yuv420p / 音轨（AAC）。
 * 不写入 data/renders，产物落在系统临时目录，跑完自动删除。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeAudioFile, checkPythonEnvironment } from "../server/lib/analysisService.ts";
import { ASSETS_DIR, ensureDir, resolvePython } from "../server/lib/paths.ts";
import { probeMedia, verifyRender } from "../server/lib/ffmpeg.ts";
import { executeRender } from "../server/lib/renderService.ts";
import type { RenderJob } from "../src/shared/types.ts";
import { DEFAULT_OUTPUT, defaultTemplateParams } from "../src/shared/constants.ts";

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".webm"]);

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function findAudio(): string {
  const explicit = arg("audio", "");
  if (explicit) return path.resolve(explicit);
  const hit = fs
    .readdirSync(ASSETS_DIR)
    .filter((n) => !n.startsWith(".") && AUDIO_EXT.has(path.extname(n).toLowerCase()))[0];
  if (!hit) throw new Error("assets/ 里没有音频文件，请先放入音频或用 --audio 指定");
  return path.join(ASSETS_DIR, hit);
}

async function main(): Promise<void> {
  const template = arg("template", "gradientPulse");
  const frames = Number(arg("frames", "60"));
  const includeAudio = arg("audio-track", "true") !== "false";
  const aspect = arg("aspect", "16:9") as "16:9" | "9:16" | "1:1";
  const fps = Number(arg("fps", "30")) as 30 | 60;

  const py = resolvePython();
  const env = await checkPythonEnvironment();
  if (!env.ok) {
    console.error(`❌ Python 环境不可用：${env.message}\n   先运行 npm run setup:python`);
    process.exit(1);
  }
  console.log(`Python ✅ ${py.bin}`);

  const audioPath = findAudio();
  console.log(`音频：${path.relative(process.cwd(), audioPath)}`);
  const { analysis } = await analyzeAudioFile(audioPath);
  console.log(`分析 ✅ ${analysis.durationSec.toFixed(3)}s  ${analysis.bpm.toFixed(2)} BPM`);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "wavemotion-verify-"));
  ensureDir(outDir);
  const outputPath = path.join(outDir, "verify.mp4");

  const job: RenderJob = {
    id: "verify",
    status: "running",
    progress: 0,
    createdAt: new Date().toISOString(),
    attempt: 1,
    snapshot: {
      audioId: "verify",
      audioPath,
      durationSec: analysis.durationSec,
      totalFrames: frames,
      width: aspect === "9:16" ? 1080 : 1920,
      height: aspect === "9:16" ? 1920 : aspect === "1:1" ? 1080 : 1080,
      includeAudio,
      visual: {
        template: template as RenderJob["snapshot"]["visual"]["template"],
        palette: "crimsonPurple",
        customColors: { background: "#0b0210", primary: "#7d0f5c", secondary: "#c0263a", accent: "#ffeaf7" },
        intensity: 0.5,
        sensitivity: 1,
        backgroundBrightness: 0.5,
        autoVariation: true,
        seed: 20251010,
        rhythm: { mode: "auto", bpm: null, offsetSec: 0, rate: 1 },
        templateParams: defaultTemplateParams(template as never),
      },
      output: { ...DEFAULT_OUTPUT, aspect, fps, includeAudio },
    },
  };

  console.log(`\n渲染 ${frames} 帧 ${aspect} ${fps}fps 音轨=${includeAudio} …`);
  const started = Date.now();
  const out = await executeRender({
    analysis,
    job,
    onProgress: () => {},
    onCancel: () => {},
    isCancelled: () => false,
  });
  if (!out) throw new Error("渲染未返回输出");
  console.log(`完成 ${(Math.max(0, Date.now() - started) / 1000).toFixed(1)}s  ${out.fileName}`);

  const info = probeMedia(out.path);
  const expectedDuration = frames / fps;
  const verify = verifyRender(out.path, {
    expectAudio: includeAudio,
    expectNoAudio: !includeAudio,
    expectedDurationSec: expectedDuration,
    durationToleranceSec: 1 / fps + 0.02,
  });

  const v = verify.video;
  const a = verify.audio;
  console.log(`\n输出：${v?.width ?? "?"}x${v?.height ?? "?"} @ ${verify.container}`);
  console.log(`  时长 ${verify.durationSec.toFixed(3)}s（期望 ${expectedDuration.toFixed(3)}s）`);
  console.log(`  视频 ${v?.codecName ?? "无"} ${v?.pixFmt ?? ""} ${v?.fps ? v.fps.toFixed(0) + "fps" : ""} 帧数 ${v?.nbFrames ?? "?"}`);
  console.log(`  音轨 ${a ? `${a.codecName} ${a.sampleRate}Hz ${a.channels}ch` : "无"}`);

  fs.rmSync(outDir, { recursive: true, force: true });

  if (!verify.ok) {
    console.error(`\n❌ 成片校验未通过：${verify.problems.join("；")}`);
    process.exit(1);
  }
  console.log("\n✅ 渲染自检通过");
}

main().catch((err) => {
  console.error(`\n❌ 渲染自检失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
