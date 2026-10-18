import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBeatTimeline } from "../src/engine/beat.ts";
import { SceneEngine } from "../src/engine/frame.ts";
import { EMPTY_ANALYSIS } from "../src/remotion/emptyAnalysis.ts";
import { DEFAULT_VISUAL } from "../src/shared/constants.ts";
import { ANALYSIS_VERSION, type RhythmConfig } from "../src/shared/types.ts";
import { GradientPulse } from "../src/templates/GradientPulse.tsx";

const analysis = { ...EMPTY_ANALYSIS, audioId: "offset-test", durationSec: 2,
  beatsSec: [.1, .6, 1.1, 1.6], beatStrengths: [.1, .2, .3, .4] };
for (const offsetSec of [-.2, .5]) {
  for (const rate of [.5, 1, 2] as const) {
    const rhythm: RhythmConfig = { mode: "auto", bpm: null, offsetSec, rate };
    const timeline = buildBeatTimeline(analysis, rhythm);
    const expectedStrengths = offsetSec < 0 ? [.2, .3, .4] : [.1, .2, .3];
    const expected = rate === .5 ? expectedStrengths.filter((_, i) => i % 2 === 0)
      : rate === 2 ? [expectedStrengths[0], .5*(expectedStrengths[0]!+expectedStrengths[1]!),
        expectedStrengths[1], .5*(expectedStrengths[1]!+expectedStrengths[2]!), expectedStrengths[2]]
      : expectedStrengths;
    assert.equal(timeline.times.length, timeline.strengths.length);
    assert.deepEqual(timeline.strengths, expected, `offset=${offsetSec} rate=${rate}`);
  }
}
const nested = { ...analysis, beatStrengths: [], rhythm: { ...analysis.rhythm, beatStrengths: [.1,.2,.3,.4] } };
assert.deepEqual(buildBeatTimeline(nested,{ mode: "auto", bpm:null,offsetSec:-.2,rate:1 }).strengths,[.2,.3,.4]);
console.log("✅ 正负偏移与半速／双速均保留正确的拍点强度配对");

const markup = (palette: typeof DEFAULT_VISUAL.palette) => {
  const visual = { ...DEFAULT_VISUAL, palette };
  const scene = new SceneEngine(visual).scene(analysis, 15, 30, 1280, 720);
  return renderToStaticMarkup(React.createElement(GradientPulse, { scene }));
};
assert.notEqual(markup("crimsonPurple"), markup("deepOcean"));
assert.match(markup("custom"), new RegExp(DEFAULT_VISUAL.customColors.primary));
console.log("✅ 默认模板实际 SVG 使用所选预设与自定义颜色");

// Isolate cache fixtures from the user's audio library and persistent data.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wm-cache-version-"));
const previous = process.env.WAVEMOTION_DATA_DIR;
process.env.WAVEMOTION_DATA_DIR = tmp;
try {
  const { analysisCacheKey, cachePathFor, loadCachedAnalysis } = await import("../server/lib/analysisService.ts");
  const audio = path.join(tmp, "audio.wav");
  fs.writeFileSync(audio, "synthetic-cache-key-fixture");
  const v1key = crypto.createHash("sha256").update(fs.readFileSync(audio)).update("|analysis-v1").digest("hex").slice(0,40);
  const key = analysisCacheKey(audio);
  assert.notEqual(key, v1key);
  fs.mkdirSync(path.dirname(cachePathFor(key)), {recursive:true});
  fs.writeFileSync(cachePathFor(v1key), JSON.stringify({...analysis,analysisVersion:"analysis-v1"}));
  assert.equal(loadCachedAnalysis(audio), null);
  fs.writeFileSync(cachePathFor(key), JSON.stringify({...analysis,analysisVersion:"analysis-v1"}));
  assert.equal(loadCachedAnalysis(audio), null);
  fs.writeFileSync(cachePathFor(key), JSON.stringify({...analysis,analysisVersion:ANALYSIS_VERSION}));
  assert.equal(loadCachedAnalysis(audio)?.analysisVersion, ANALYSIS_VERSION);
  const script = fs.readFileSync(new URL("../python/analyze.py", import.meta.url),"utf8");
  assert.match(script,new RegExp(`ANALYSIS_VERSION = "${ANALYSIS_VERSION}"`));
  console.log("✅ Python／TypeScript 版本一致；旧缓存失效，当前版本缓存可复用");
} finally {
  if(previous===undefined)delete process.env.WAVEMOTION_DATA_DIR;
  else process.env.WAVEMOTION_DATA_DIR=previous;
  fs.rmSync(tmp,{recursive:true,force:true});
}
