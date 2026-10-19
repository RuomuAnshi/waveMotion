import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Keep framework symlinks on the system filesystem even when this checkout is
// on exFAT. Resolving require('electron') would auto-extract into node_modules.
export async function ensureElectronBinary(cache){
  const electronPackage=require.resolve('electron/package.json');
  const electronRequire=createRequire(electronPackage);
  const {version}=JSON.parse(fs.readFileSync(electronPackage,'utf8'));
  const folder=path.join(cache,'electron',version);
  const executable=path.join(folder,process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron');
  if(!fs.existsSync(executable)){
    const {downloadArtifact}=electronRequire('@electron/get');
    const checksums=electronRequire('./checksums.json');
    const file=`electron-v${version}-${process.platform}-${process.arch}.zip`;
    const cached=path.join(cache,'downloads',file);
    let zip;
    if(fs.existsSync(cached)){
      const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(cached))hash.update(chunk);
      if(hash.digest('hex')!==checksums[file])throw new Error('Electron 预下载压缩包校验失败。');
      zip=cached;
    }else zip=await downloadArtifact({version,artifactName:'electron',platform:process.platform,arch:process.arch,checksums});
    fs.mkdirSync(folder,{recursive:true});
    const {extract}=electronRequire('@electron-internal/extract-zip');
    await extract(zip,{dir:folder});
  }
  return {folder,executable};
}
