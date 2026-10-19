import fs from 'node:fs';
import path from 'node:path';
import {build, Platform} from 'electron-builder';
import {buildDesktop,root,cache,runtime} from './build-desktop.mjs';
import {ensureElectronBinary} from './electron-binary.mjs';
await buildDesktop();
const electron=await ensureElectronBinary(cache);
const platform=process.platform==='darwin'?Platform.MAC:process.platform==='win32'?Platform.WINDOWS:Platform.LINUX;
const channel=process.argv.includes('--release')?'':'-dev';
const files=await build({targets:platform.createTarget(process.platform==='darwin'?['dmg','zip']:process.platform==='win32'?['nsis']:['AppImage']),publish:'never',config:{
  appId:'moe.shelterhub.wavemotion',productName:'WaveMotion',icon:path.join(root,'public/wavemotion-icon.png'),asar:true,npmRebuild:false,
  electronDist:electron.folder,
  directories:{app:root,output:path.join(cache,'release')},
  files:['desktop/*.cjs','dist/desktop/**','dist/web/**','package.json','LICENSE','!**/._*','!node_modules/.remotion/**','!node_modules/@remotion/compositor-*/**'],
  extraResources:[{from:runtime,to:'runtime',filter:['**/*','!**/._*','!**/.DS_Store','!analyzer-source.txt','!python-dist/**']},{from:path.join(root,'dist/composition'),to:'composition'}],
  artifactName:'WaveMotion-${version}'+channel+'-${os}-${arch}.${ext}',
  mac:{category:'public.app-category.video',identity:null,minimumSystemVersion:'15.0'},
  win:{target:'nsis'},linux:{category:'AudioVideo'},
  nsis:{oneClick:false,allowToChangeInstallationDirectory:true},
}});
const output=path.join(root,'desktop-release');fs.mkdirSync(output,{recursive:true});
for(const file of files){if(fs.existsSync(file)&&fs.statSync(file).isFile()){const to=path.join(output,path.basename(file));fs.copyFileSync(file,to);console.log(`Artifact: ${to}`);}}
