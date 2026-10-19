import {spawn} from 'node:child_process';
import {buildDesktop,root,runtime,cache} from './build-desktop.mjs';
import {ensureElectronBinary} from './electron-binary.mjs';
await buildDesktop({withRuntime:!process.argv.includes('--system-runtime')});
const electron=await ensureElectronBinary(cache);
const env={...process.env,WAVEMOTION_RUNTIME_DIR:runtime};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron.executable,[root],{cwd:root,stdio:'inherit',env});
child.on('exit',code=>process.exit(code??1));
