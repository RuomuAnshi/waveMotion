const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {runtimeEnvironment,allowNavigation}=require('../desktop/runtime.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wm-desktop-runtime-'));
try{
  const runtime=path.join(tmp,'runtime');fs.mkdirSync(runtime);
  const root=path.join(tmp,'app.asar'),userData=path.join(tmp,'user');
  assert.throws(()=>runtimeEnvironment({root,runtime,userData,packaged:true,env:{}}),/缺少运行时/);
  const manifest={analyzer:'analyzer/program',browser:'browser/program',compositor:'compositor',ffmpeg:'ffmpeg',assets:'assets'};
  for(const p of ['analyzer/program','browser/program','compositor/.keep','ffmpeg/.keep','assets/.keep']){const f=path.join(runtime,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'');}
  fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify(manifest));
  const env=runtimeEnvironment({root,runtime,userData,packaged:true,env:{ELECTRON_RUN_AS_NODE:'1',WAVEMOTION_AUTOSTART:'1'}});
  assert.equal(env.NODE_ENV,'production');assert.equal(env.WAVEMOTION_DATA_DIR,path.join(userData,'data'));
  assert.equal(env.WAVEMOTION_REMOTION_BUNDLE,path.join(tmp,'composition'));
  assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(env.WAVEMOTION_AUTOSTART,undefined);
  assert.equal(allowNavigation('http://127.0.0.1:4000/api/audio','http://127.0.0.1:4000'),true);
  for(const url of ['https://example.com','file:///etc/passwd','javascript:alert(1)','http://127.0.0.1:4001/'])assert.equal(allowNavigation(url,'http://127.0.0.1:4000'),false);
  manifest.browser='../outside';fs.writeFileSync(path.join(tmp,'outside'),'');fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify(manifest));
  assert.throws(()=>runtimeEnvironment({root,runtime,userData,packaged:true,env:{}}),/运行时文件缺失/);
  console.log('✅ 桌面资源定位、用户数据隔离、导航限制与清单路径校验通过');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
