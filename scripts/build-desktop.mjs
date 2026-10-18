import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {bundle} from '@remotion/bundler';
import {ensureBrowser} from '@remotion/renderer';

const require=createRequire(import.meta.url);
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const cache=process.env.WAVEMOTION_BUILD_CACHE || path.join(os.homedir(),process.platform==='darwin'?'Library/Caches/WaveMotion/build':'.cache/wavemotion/build',`${process.platform}-${process.arch}`);
export const runtime=path.join(cache,'runtime');
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',env:process.env});if(r.status!==0)throw new Error(`${command} failed (${r.status}): ${r.error?.message||''}`);}
function demo(file){
  const sr=22050,n=sr*8,buf=Buffer.alloc(44+n*2);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++){const t=i/sr,phase=t%.5;buf.writeInt16LE(Math.round(Math.sin(2*Math.PI*(110+70*Math.exp(-phase*30))*t)*Math.exp(-phase*22)*16000),44+i*2);}
  fs.writeFileSync(file,buf);
}
async function prepareRuntime(){
  fs.mkdirSync(runtime,{recursive:true});
  const py=process.env.WAVEMOTION_PYTHON || path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!fs.existsSync(py))throw new Error('先执行 npm run setup:python，并安装 python/requirements-build.txt。');
  const analyzerDir=path.join(runtime,'analyzer');
  const analyzer=path.join(analyzerDir,process.platform==='win32'?'wavemotion-analyzer.exe':'wavemotion-analyzer');
  // Rebuild when Python source or pinned build/runtime dependencies change.
  const fingerprint=Buffer.concat(['python/analyze.py','python/requirements.txt','python/requirements-build.txt'].map(f=>fs.readFileSync(path.join(root,f)))).toString('base64');
  const stamp=path.join(runtime,'analyzer-source.txt');
  if(!fs.existsSync(analyzer) || !fs.existsSync(stamp) || fs.readFileSync(stamp,'utf8')!==fingerprint){
    run(py,['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','wavemotion-analyzer','--distpath',path.join(runtime,'python-dist'),'--workpath',path.join(cache,'pyinstaller'),'--specpath',path.join(cache,'spec'),'--collect-all','librosa','--collect-all','llvmlite','--collect-data','lazy_loader',path.join(root,'python/analyze.py')]);
    fs.rmSync(analyzerDir,{recursive:true,force:true});
    fs.renameSync(path.join(runtime,'python-dist','wavemotion-analyzer'),analyzerDir);
    fs.writeFileSync(stamp,fingerprint);
  }
  const browserStatus=await ensureBrowser({chromeMode:'headless-shell'});
  if(!('path' in browserStatus))throw new Error('无法准备 Remotion 渲染浏览器');
  const browserSource=path.dirname(browserStatus.path);
  fs.cpSync(browserSource,path.join(runtime,'browser'),{recursive:true,force:true,filter:p=>!path.basename(p).startsWith('._')});
  const browser=path.join('browser',path.basename(browserStatus.path));
  const compositorPackage=`@remotion/compositor-${process.platform}-${process.arch}`;
  const compositor=path.dirname(require.resolve(`${compositorPackage}/package.json`));
  fs.cpSync(compositor,path.join(runtime,'compositor'),{recursive:true,force:true,filter:p=>!path.basename(p).startsWith('._')});
  fs.mkdirSync(path.join(runtime,'assets'),{recursive:true});demo(path.join(runtime,'assets','节拍演示.wav'));
  fs.mkdirSync(path.join(runtime,'ffmpeg'),{recursive:true});
  fs.copyFileSync(require('ffmpeg-static'),path.join(runtime,'ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'));
  for(const file of ['ffmpeg.LICENSE','ffmpeg.README']) {
    const from=path.join(path.dirname(require('ffmpeg-static')),file);
    if(fs.existsSync(from))fs.copyFileSync(from,path.join(runtime,'ffmpeg',file));
  }
  if(process.platform!=='win32')fs.chmodSync(path.join(runtime,'ffmpeg','ffmpeg'),0o755);
  fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify({platform:process.platform,arch:process.arch,analyzer:path.relative(runtime,analyzer),browser,compositor:'compositor',ffmpeg:'ffmpeg',assets:'assets'},null,2));
  const notices=['electron','@remotion/renderer','librosa','numpy','scipy','soundfile','ffmpeg-static'];
  fs.writeFileSync(path.join(runtime,'THIRD-PARTY-NOTICES.txt'),`WaveMotion runtime dependencies\n${notices.join('\n')}\nElectron/Chromium: https://www.electronjs.org/\nRemotion/compositor/FFprobe: https://github.com/remotion-dev/remotion\nFFmpeg binaries and corresponding sources/licenses: https://github.com/eugeneware/ffmpeg-static\nPython libraries: see their bundled distribution metadata/licenses.\n`);
  console.log(`Runtime ready: ${runtime}`);
}
export async function buildDesktop({withRuntime=true}={}){
  run(process.platform==='win32'?'npm.cmd':'npm',['run','build']);
  await build({entryPoints:[path.join(root,'desktop/backend.ts')],outfile:path.join(root,'dist/desktop/backend.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',sourcemap:true});
  await bundle({entryPoint:path.join(root,'src/remotion/root.tsx'),outDir:path.join(root,'dist/composition')});
  if(withRuntime)await prepareRuntime();
}
if(process.argv[1]===fileURLToPath(import.meta.url))await buildDesktop({withRuntime:!process.argv.includes('--skip-runtime')});
