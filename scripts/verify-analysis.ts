/**
 * 分析自检：确认 Python 环境可用，并把 assets 里的音频跑一遍分析。
 *
 * 用法：npm run verify:analysis [-- <音频路径>]
 * 默认检查 assets/wav.wav。输出 BPM、拍点数、节奏置信度与关键能量统计。
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeAudioFile, checkPythonEnvironment } from "../server/lib/analysisService.ts";
import { ASSETS_DIR, ensureAllDirs, resolvePython } from "../server/lib/paths.ts";

function findDefaultAudio(): string | null {
  const explicit = process.argv[2];
  if (explicit) return path.resolve(explicit);
  if (!fs.existsSync(ASSETS_DIR)) return null;
  const exts = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".webm"]);
  const hit = fs
    .readdirSync(ASSETS_DIR)
    .filter((n) => !n.startsWith("."))
    .find((n) => exts.has(path.extname(n).toLowerCase()));
  return hit ? path.join(ASSETS_DIR, hit) : null;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const py = resolvePython();
  console.log(`Python: ${py.bin} (${py.isolated ? "隔离环境" : "系统环境"})`);

  const env = await checkPythonEnvironment();
  if (!env.ok) {
    console.error(`\n❌ Python 环境不可用：${env.message}`);
    console.error("   运行 npm run setup:python 创建隔离环境。");
    process.exit(1);
  }
  console.log("✅ Python 环境就绪（librosa 可导入）");

  const file = findDefaultAudio();
  if (!file || !fs.existsSync(file)) {
    console.error("\n❌ 没找到可分析的音频。把音频放进 assets/，或显式传入路径：");
    console.error("   npm run verify:analysis -- /path/to/audio.wav");
    process.exit(1);
  }

  console.log(`\n分析：${path.relative(process.cwd(), file)}`);
  const started = Date.now();
  const { analysis, cached } = await analyzeAudioFile(file, {
    onProgress: (p, msg) => {
      if (msg) process.stdout.write(`  ${pct(p)} ${msg}\n`);
    },
  });
  const elapsed = Date.now() - started;

  const fmt = (v: number, digits = 2) => Number(v).toFixed(digits);
  console.log(`  缓存命中：${cached ? "是" : "否"}（${(elapsed / 1000).toFixed(1)}s）`);
  console.log(`  时长：${fmt(analysis.durationSec, 3)}s  ${analysis.sampleRate}Hz  ${analysis.channels}ch`);
  console.log(`  BPM：${fmt(analysis.bpm)}  拍点：${analysis.beatsSec.length}  起音：${analysis.onsetsSec.length}`);
  console.log(`  节奏：稳定度 ${pct(analysis.rhythm.stability)}  置信度 ${pct(analysis.rhythm.confidence)}`);
  if (typeof analysis.rhythm.beatSalience === "number") {
    console.log(`        重音显著性 ${pct(analysis.rhythm.beatSalience)}`);
  }
  console.log(`  响度：峰值 ${fmt(analysis.loudness.peakDbfs)}dBFS  均值 ${fmt(analysis.loudness.meanDbfs)}dBFS`);
  console.log(`        静音开头 ${fmt(analysis.loudness.silentIntroSec, 2)}s  静音占比 ${pct(analysis.loudness.silentRatio)}`);
  console.log(`  序列：rms ${analysis.rms.length}  low ${analysis.low.length}  mid ${analysis.mid.length}  high ${analysis.high.length}`);
  const specFrames = analysis.spectrumBands > 0 ? Math.round(analysis.spectrumFlat.length / analysis.spectrumBands) : 0;
  console.log(`  频谱：${analysis.spectrumBands} 段 × ${specFrames} 帧`);

  const warnings: string[] = analysis.warnings ?? [];
  if (warnings.length) {
    console.log("\n⚠️  提示：");
    for (const w of warnings) console.log(`   · ${w}`);
  }
  if (analysis.rhythm.needsCorrection) {
    console.log(`\n⚠️  建议手动校正节奏：${analysis.rhythm.hint || "检测到的拍点可能不准"}`);
  }

  const problems: string[] = [];
  if (!(analysis.bpm > 0)) problems.push("BPM 未检测到");
  if (analysis.beatsSec.length < 4) problems.push("拍点过少");
  if (!(analysis.durationSec > 0)) problems.push("时长无效");
  if (analysis.rms.length === 0) problems.push("能量序列为空");

  if (problems.length) {
    console.error(`\n❌ 分析结果异常：${problems.join("；")}`);
    process.exit(1);
  }
  console.log("\n✅ 分析自检通过");
}

main().catch((err) => {
  console.error(`\n❌ 分析失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
