const { app, BrowserWindow, dialog, Menu, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeEnvironment, allowNavigation } = require('./runtime.cjs');
let window, backend, appUrl;
let quitting = false;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
    {label:'文件',submenu:[{label:'打开数据目录',click:()=>shell.openPath(path.join(app.getPath('userData'),'data'))},{label:'打开日志目录',click:()=>shell.openPath(app.getPath('logs'))},{type:'separator'},{role:process.platform==='darwin'?'close':'quit'}]},
    {role:'editMenu',label:'编辑'},
    {label:'视图',submenu:[{role:'reload'},{role:'toggleDevTools'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {role:'windowMenu',label:'窗口'},
    {label:'帮助',submenu:[{label:'项目主页',click:()=>shell.openExternal('https://github.com/RuomuAnshi/waveMotion')},{label:`WaveMotion ${app.getVersion()}`,enabled:false}]},
  ]));
}
async function createWindow() {
  window = new BrowserWindow({width:1440,height:960,minWidth:600,minHeight:640,backgroundColor:'#08080b',show:false,title:'WaveMotion',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.webContents.setWindowOpenHandler(({url})=>{
    if(allowNavigation(url,appUrl) && new URL(url).pathname.endsWith('/export'))window.webContents.downloadURL(url);
    return {action:'deny'};
  });
  window.webContents.on('will-navigate',(event,url)=>{if(!allowNavigation(url,appUrl))event.preventDefault();});
  window.webContents.session.on('will-download',(_event,item)=>{
    item.setSaveDialogOptions({title:'保存 WaveMotion 文件',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});
  });
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(appUrl);
  window.on('closed',()=>{window=null;});
}
async function start() {
  app.setAppLogsPath();
  const root = app.getAppPath();
  const runtime = app.isPackaged ? path.join(process.resourcesPath,'runtime') : (process.env.WAVEMOTION_RUNTIME_DIR || path.join(root,'desktop-runtime'));
  const logFile = path.join(app.getPath('logs'),'backend.log');
  fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const log = fs.createWriteStream(logFile,{flags:'a'});
  const env = runtimeEnvironment({root,runtime,userData:app.getPath('userData'),packaged:app.isPackaged,env:process.env});
  backend = utilityProcess.fork(path.join(root,'dist/desktop/backend.mjs'),[],{env,stdio:'pipe',serviceName:'WaveMotion Local Service'});
  backend.stdout?.pipe(log,{end:false});backend.stderr?.pipe(log,{end:false});
  appUrl = await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('本地服务启动超时，请查看日志。')),60000);
    backend.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);resolve(message.url);}});
    backend.once('exit',code=>{clearTimeout(timeout);backend=null;reject(new Error(`本地服务退出（${code}），请查看日志。`));});
  });
  backend.on('exit',()=>{backend=null;if(!quitting){dialog.showErrorBox('WaveMotion 服务已停止','请重新启动应用。日志目录可从“文件”菜单打开。');app.quit();}});
  menu();
  await createWindow();
}
if(single)app.whenReady().then(start).catch(error=>{dialog.showErrorBox('WaveMotion 启动失败',error.message);app.quit();});
app.on('activate',()=>{if(appUrl && !window)void createWindow();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',event=>{
  if(quitting || !backend)return;
  event.preventDefault();quitting=true;
  backend.postMessage({type:'shutdown'});
  const timer=setTimeout(()=>{backend?.kill();app.quit();},8000);
  backend.once('exit',()=>{clearTimeout(timer);app.quit();});
});
