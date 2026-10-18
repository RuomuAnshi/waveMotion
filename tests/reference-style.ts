import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gradientPulseState} from '../src/templates/GradientPulse.tsx';
import {SceneEngine} from '../src/engine/frame.ts';
import {DEFAULT_VISUAL} from '../src/shared/constants.ts';
import {EMPTY_ANALYSIS} from '../src/remotion/emptyAnalysis.ts';
import {scanFrameIntegrity, resolveFfmpegBin} from '../server/lib/ffmpeg.ts';

const analysis = {...EMPTY_ANALYSIS, audioId:'reference-style-test',durationSec:12,
  bpm:120, beatsSec:Array.from({length:24},(_,i)=>i*.5),beatStrengths:Array(24).fill(1),
  frameRate:60,rms:Array(720).fill(.8),low:Array(720).fill(.6),mid:Array(720).fill(.4),high:Array(720).fill(.2),
  onsetStrength:Array(720).fill(.4),spectrumFlat:Array(720*32).fill(.3)};
const engine = new SceneEngine(DEFAULT_VISUAL);
const state = (sec:number)=>gradientPulseState(engine.scene(analysis,sec*60,60,1280,720));
assert.equal(state(0).ringOpacity,0,'开场只有圆盘，没有常驻白环');
assert.ok(state(0).discRadius<state(1).discRadius,'开场圆盘持续放大');
assert.ok(state(1).discRadius<state(1.7).discRadius);
const introRadii = Array.from({length:90},(_,i)=>state(i/60).discRadius);
assert.ok(introRadii.every((r,i)=>i===0 || r>introRadii[i-1]!), '开场逐帧连续运动，而非按拍点换静态尺寸');
assert.ok(introRadii.slice(1).every((r,i)=>r-introRadii[i]!<20), '开场相邻帧没有尺寸突跳');
assert.ok(state(2).ringOpacity>.9,'第一个活跃拍点触发描边');
assert.ok(state(2.2).ringRadius>state(2).ringRadius,'描边向外扩散');
assert.ok(state(2.2).ringWidth<state(2).ringWidth,'描边逐渐变细');
assert.equal(state(2.4).ringOpacity,0,'拍间描边完全消失');
assert.equal(state(4.5).ringOpacity,0,'休止段不显示描边');
assert.ok(state(5.5).discRadius<state(4.5).discRadius,'休止段收回圆盘');
const ocean = new SceneEngine({...DEFAULT_VISUAL,palette:'deepOcean'});
assert.notEqual(state(2).center,gradientPulseState(ocean.scene(analysis,120,60,1280,720)).center,'配色确实改变画面');
assert.deepEqual(state(2.2),state(2.2),'任意帧重访一致');
console.log('✅ 圆盘／拍点描边／收缩／配色行为通过');

// Legitimate circular black masks in both orientations must not be classified
// as GPU stripe loss. The exact same frames with their lower half erased must.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wm-reference-integrity-'));
try {
  for (const [width,height] of [[320,180],[180,320]]) {
    for (const broken of [false,true]) {
      const buf=Buffer.alloc(width*height*3);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        if((x-(width-1)/2)**2+(y-(height-1)/2)**2>(Math.min(width,height)*.56)**2)continue;
        if(broken && y>=height*.5)continue;
        const offset=(y*width+x)*3;buf[offset]=112;buf[offset+1]=10;buf[offset+2]=131;
      }
      const file=path.join(dir,`${width}-${broken}.mp4`);
      const result=spawnSync(resolveFfmpegBin(),['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-framerate','30','-i','pipe:0','-frames:v','1','-c:v','libx264','-pix_fmt','yuv420p',file],{input:buf});
      assert.equal(result.status,0,result.stderr?.toString());
      const scan=await scanFrameIntegrity(file);
      assert.equal(scan.corrupt.length,broken?1:0,`${width}x${height} broken=${broken} ratio=${scan.maxBlackRatio}`);
    }
  }
  console.log('✅ 横竖屏黑底圆盘被接受，单侧缺条带被拒绝');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
