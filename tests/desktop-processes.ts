import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { trackChild, stopChildProcesses } from "../server/lib/childProcesses.ts";
import { EMPTY_ANALYSIS } from "../src/remotion/emptyAnalysis.ts";
import { DEFAULT_OUTPUT, DEFAULT_VISUAL } from "../src/shared/constants.ts";
const child = trackChild(spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}));
await once(child,"spawn");const exited=once(child,"exit");stopChildProcesses();const [,signal]=await exited;
assert.equal(signal,"SIGTERM");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"wm-desktop-jobs-"));const previous=process.env.WAVEMOTION_DATA_DIR;
process.env.WAVEMOTION_DATA_DIR=dir;
try {
  const {renderQueue}=await import("../server/lib/renderQueue.ts");
  let started=0;
  renderQueue.configure({render:async(_job,ctx)=>{started++;await new Promise<void>(resolve=>ctx.onCancel(resolve));},onUpdate:()=>{}});
  const input={audioId:"fixture",audioPath:"fixture",audioName:"fixture",analysis:EMPTY_ANALYSIS,visual:DEFAULT_VISUAL,output:DEFAULT_OUTPUT,durationSec:1};
  renderQueue.create(input);renderQueue.create(input);renderQueue.create(input);renderQueue.cancelPending();
  assert.equal(await renderQueue.waitForIdle(),true);
  assert.ok(renderQueue.list().every(j=>j.status==="cancelled"));assert.equal(started,1);
  console.log("✅ 退出时停止自有子进程，取消当前及排队任务，不再启动下一项");
}finally{
  if(previous===undefined)delete process.env.WAVEMOTION_DATA_DIR;else process.env.WAVEMOTION_DATA_DIR=previous;
  // Queue persistence uses a short debounce after a progress update; no progress
  // updates are issued by this fixture, so no writer remains after shutdown.
  fs.rmSync(dir,{recursive:true,force:true});
}
