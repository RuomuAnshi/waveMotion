const fs = require('node:fs');
const path = require('node:path');
function runtimeEnvironment({root,runtime,userData,packaged,env=process.env}) {
  const manifestPath=path.join(runtime,'manifest.json');
  const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
  if(packaged && !manifest)throw new Error('安装包缺少运行时，请重新构建完整安装包。');
  const variables={...env,NODE_ENV:'production',WAVEMOTION_ROOT_DIR:root,WAVEMOTION_WEB_DIST:path.join(root,'dist/web'),WAVEMOTION_DATA_DIR:path.join(userData,'data')};
  variables.NUMBA_CACHE_DIR=path.join(userData,'data/tmp/numba');
  variables.XDG_CACHE_HOME=path.join(userData,'data/tmp/cache');
  delete variables.ELECTRON_RUN_AS_NODE;
  delete variables.WAVEMOTION_AUTOSTART;
  if(manifest){
    const resolve=(name)=>{const p=path.resolve(runtime,manifest[name]);if(!p.startsWith(path.resolve(runtime)+path.sep) || !fs.existsSync(p))throw new Error(`运行时文件缺失：${name}`);return p;};
    variables.WAVEMOTION_ANALYZER=resolve('analyzer');
    variables.WAVEMOTION_CHROME=resolve('browser');
    variables.WAVEMOTION_BINARIES_DIR=resolve('compositor');
    const ffmpeg=resolve('ffmpeg');
    variables.WAVEMOTION_FFMPEG=path.join(ffmpeg,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
    variables.WAVEMOTION_FFPROBE=path.join(variables.WAVEMOTION_BINARIES_DIR,process.platform==='win32'?'ffprobe.exe':'ffprobe');
    variables.WAVEMOTION_ASSETS_DIR=resolve('assets');
  }
  variables.WAVEMOTION_REMOTION_BUNDLE=packaged?path.join(path.dirname(runtime),'composition'):path.join(root,'dist/composition');
  return variables;
}
function allowNavigation(url,origin){try{return new URL(url).origin===new URL(origin).origin;}catch{return false;}}
module.exports={runtimeEnvironment,allowNavigation};
