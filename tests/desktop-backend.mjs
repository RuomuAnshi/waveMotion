import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';
const root=process.cwd();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wm-desktop-backend-'));
fs.mkdirSync(path.join(tmp,'assets'));fs.mkdirSync(path.join(tmp,'readonly'));
const env={...process.env,NODE_ENV:'production',WAVEMOTION_ROOT_DIR:path.join(tmp,'readonly'),WAVEMOTION_DATA_DIR:path.join(tmp,'data'),WAVEMOTION_ASSETS_DIR:path.join(tmp,'assets'),WAVEMOTION_WEB_DIST:path.join(root,'dist/web')};
delete env.WAVEMOTION_AUTOSTART;
const child=fork(path.join(root,'dist/desktop/backend.mjs'),[],{env,stdio:['ignore','pipe','pipe','ipc']});
let logs='';child.stdout.on('data',d=>logs+=String(d));child.stderr.on('data',d=>logs+=String(d));
try{
  const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Backend startup timeout: '+logs)),15000);child.once('message',m=>{clearTimeout(timeout);resolve(m);});child.once('exit',c=>{clearTimeout(timeout);reject(new Error('Backend exited '+c+': '+logs));});});
  assert.equal(ready.type,'ready');const url=ready.url;assert.notEqual(new URL(url).port,'3210');
  const home=await fetch(url);assert.equal(home.status,200);assert.match(await home.text(),/WaveMotion/);
  assert.equal((await fetch(url+'/api/audio')).status,200);
  assert.equal((await fetch(url+'/api/missing')).status,404);
  assert.equal((await fetch(url+'/api/audio',{headers:{origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(url+'/api/audio',{headers:{origin:url}})).status,200);
  assert.ok(fs.existsSync(path.join(tmp,'data','renders')));assert.equal(fs.readdirSync(path.join(tmp,'readonly')).length,0);
  const exited=once(child,'exit');child.send({type:'shutdown'});const [code]=await exited;assert.equal(code,0);
  await assert.rejects(fetch(url));
  console.log('✅ 独立服务随机端口、生产界面、来源限制、数据隔离和退出清理通过');
}finally{if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
