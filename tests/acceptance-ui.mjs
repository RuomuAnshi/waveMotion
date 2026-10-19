#!/usr/bin/env node
/**
 * 验收：真实浏览器里的界面行为（通过 CDP 驱动无头 Chrome）。
 *  - 模板参数按模板分别记忆，切回来时恢复
 *  - 刷新页面后从 localStorage 恢复当前模板参数
 *  - 异步挂载后的播放／暂停／时间进度和定位同步
 *
 * 需要先启动服务（npm run dev 或 npm start）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveChrome } from "./lib/env.mjs";

const CHROME = resolveChrome();
const APP_URL = process.env.WM_URL || "http://127.0.0.1:5179/";
const PORT = Number(process.env.WM_CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = path.join(os.tmpdir(), "wm-ui-profile");
fs.rmSync(profile, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--no-sandbox",
  "--disable-gpu", "--hide-scrollbars", "--window-size=1680,1000", APP_URL,
], { stdio: "ignore" });

let ws;
let exitCode = 1;
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* 等 Chrome 起来 */ }
    await sleep(500);
  }
  if (!ws) throw new Error("无法连接 CDP，Chrome 可能没启动");
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: `(function(){try{return JSON.stringify(${expr})}catch(e){return JSON.stringify({__err:String(e)})}})()`,
      awaitPromise: true,
      returnByValue: true,
      // CDP evaluations which click playback controls must carry the same user
      // activation as a real click; otherwise Chromium blocks audible autoplay.
      userGesture: true,
    });
    if (r.exceptionDetails) return { __exc: JSON.stringify(r.exceptionDetails).slice(0, 300) };
    try { return JSON.parse(r.result.value); } catch { return r.result.value; }
  };

  await send("Page.enable");
  await send("Runtime.enable");

  const waitFor = async (expr, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expr)) return true;
      await sleep(400);
    }
    return false;
  };

  const readParam = (label) => evaluate(`(() => {
    const fields = [...document.querySelectorAll("label.field")];
    const f = fields.find((el) => { const h = el.querySelector(".field-head"); return h && h.textContent.includes(${JSON.stringify(label)}); });
    if (!f) return null;
    const v = f.querySelector(".field-value");
    return v ? Number(v.textContent) : null;
  })()`);

  const setParam = (label, value) => evaluate(`(() => {
    const fields = [...document.querySelectorAll("label.field")];
    const f = fields.find((el) => { const h = el.querySelector(".field-head"); return h && h.textContent.includes(${JSON.stringify(label)}); });
    if (!f) return "未找到 " + ${JSON.stringify(label)};
    const input = f.querySelector('input[type="range"]');
    if (!input) return "没有滑块 " + ${JSON.stringify(label)};
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, String(${value}));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`);

  const clickTemplate = (name) => evaluate(`(() => {
    const card = [...document.querySelectorAll(".template-card")].find((el) => el.textContent.includes(${JSON.stringify(name)}));
    if (!card) return "未找到模板 " + ${JSON.stringify(name)};
    card.click();
    return "ok";
  })()`);

  if (!(await waitFor(`!!document.querySelector(".template-card")`))) {
    throw new Error("界面未渲染出模板列表，请确认服务已启动且地址正确：" + APP_URL);
  }
  await sleep(1200);

  const rows = [];
  const check = (name, ok, detail = "") => {
    rows.push(ok);
    console.log(`${ok ? "✅" : "❌"} ${name}${detail !== "" ? "  " + detail : ""}`);
  };

  // Inspector navigation must reveal the matching controls without losing edits.
  await evaluate(`(() => { document.querySelector('#tab-rhythm').click(); return true; })()`);
  check("节奏页签显示对应面板", await waitFor(`!document.querySelector('#panel-rhythm').hidden && document.querySelector('#panel-appearance').hidden`));
  await evaluate(`(() => { document.querySelector('.header-export').click(); return true; })()`);
  check("顶部导出入口显示导出面板", await waitFor(`!document.querySelector('#panel-export').hidden && document.querySelector('#tab-export').getAttribute('aria-selected') === 'true'`));
  await evaluate(`(() => { document.querySelector('#tab-export').dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true})); return true; })()`);
  check("检查器支持键盘切换并管理焦点", await waitFor(`!document.querySelector('#panel-appearance').hidden && document.activeElement.id === 'tab-appearance'`));

  await send("Emulation.setDeviceMetricsOverride", {width:375, height:812, deviceScaleFactor:1, mobile:false});
  await sleep(300);
  check("375px 窗口无横向溢出", await evaluate(`document.documentElement.scrollWidth <= 375 && [...document.querySelectorAll('.stage,.sidebar-left,.sidebar-right')].every(el => el.getBoundingClientRect().width <= 375)`));
  await send("Emulation.clearDeviceMetricsOverride");

  // Fresh page: Player does not exist on the initial render. Waiting for the
  // actual preview catches effects that subscribe only before its async mount.
  const previewReady = await waitFor(`!!document.querySelector(".preview-player-wrap")`, 60000);
  check("音频分析后播放器成功挂载", previewReady);
  if (!previewReady) throw new Error("播放器未加载，无法验证播放状态");
  const timeText = () => evaluate(`document.querySelector(".transport-time .mono").textContent`);
  await evaluate(`(() => { document.querySelector('.transport button[title="播放 / 暂停（空格）"]').click(); return true; })()`);
  const playbackReady = await waitFor(`document.querySelector('.transport button[title="播放 / 暂停（空格）"]').textContent.includes("暂停") && document.querySelector(".transport-time .mono").textContent !== "0:00.00"`, 10000);
  check("首次播放更新按钮和时间", playbackReady);
  if (!playbackReady) console.log("播放诊断：", await evaluate(`({transport:document.querySelector(".transport").textContent, audio:[...document.querySelectorAll("audio")].map(a=>({paused:a.paused,time:a.currentTime,readyState:a.readyState,error:a.error?.message}))})`));
  await evaluate(`(() => { document.querySelector('.transport button[title="播放 / 暂停（空格）"]').click(); return true; })()`);
  check("暂停后按钮恢复播放", await waitFor(`document.querySelector('.transport button[title="播放 / 暂停（空格）"]').textContent.includes("播放")`));
  await sleep(200);
  const pausedAt = await timeText();
  await sleep(400);
  check("暂停后时间保持不变", (await timeText()) === pausedAt);
  await evaluate(`(() => { document.querySelector('.transport button[title="前进 1 秒"]').click(); return true; })()`);
  check("暂停时定位更新预览时间", await waitFor(`document.querySelector(".transport-time .mono").textContent !== ${JSON.stringify(pausedAt)}`));
  await evaluate(`(() => { document.querySelector('.transport button[title="回到开头"]').click(); return true; })()`);
  check("回到开头同步归零", await waitFor(`document.querySelector(".transport-time .mono").textContent === "0:00.00"`));

  // 1) 渐变脉冲：把「多边形边数」改成 8
  await clickTemplate("渐变几何脉冲");
  await sleep(400);
  await setParam("多边形边数", 8);
  await sleep(300);
  check("渐变脉冲 边数设为 8", (await readParam("多边形边数")) === 8, await readParam("多边形边数"));

  // 2) 切到霓虹光环：显示自己的默认参数，不带过多边形边数
  await clickTemplate("霓虹光环");
  await sleep(600);
  check("切到霓虹光环显示自己的参数", (await readParam("光环数量")) === 5, await readParam("光环数量"));
  check("霓虹光环不显示多边形边数", (await evaluate(`document.body.textContent.includes("多边形边数")`)) === false);

  // 3) 霓虹光环改成 9
  await setParam("光环数量", 9);
  await sleep(300);
  check("霓虹光环数量设为 9", (await readParam("光环数量")) === 9, await readParam("光环数量"));

  // 4) 切回渐变脉冲应恢复 8
  await clickTemplate("渐变几何脉冲");
  await sleep(600);
  check("切回渐变脉冲恢复 8", (await readParam("多边形边数")) === 8, await readParam("多边形边数"));

  // 5) 再切回霓虹光环应恢复 9
  await clickTemplate("霓虹光环");
  await sleep(600);
  check("切回霓虹光环恢复 9", (await readParam("光环数量")) === 9, await readParam("光环数量"));

  // 6) 刷新后从 localStorage 恢复
  await send("Page.reload");
  await waitFor(`!!document.querySelector(".template-card")`, 25000);
  await sleep(1500);
  check("刷新后记住光环数量 9", (await readParam("光环数量")) === 9, await readParam("光环数量"));

  const failed = rows.filter((ok) => !ok).length;
  console.log(failed === 0 ? `\n✅ 界面验收全部通过（${rows.length} 项）` : `\n❌ ${failed}/${rows.length} 项失败`);
  exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error("❌ 界面验收出错：", err.message);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  process.exit(exitCode);
}
