// 计划任务预加载此模块，让任务计划程序直接管理守护进程的启动、停止和退出码。
import fs from 'node:fs';

const dataDir = new URL('../../data/', import.meta.url);
fs.mkdirSync(dataDir, { recursive: true });
const log = fs.openSync(new URL('daemon.log', dataDir), 'a');

function writeLog(text) {
  fs.appendFileSync(log, text.replace(/(\?key=)[^&#\s]+/g, '$1[已隐藏]'));
}

const lifecycle = (message) => writeLog(`[${new Date().toISOString()}] ${message}\n`);
lifecycle('启动麦田守护进程');

// 同步追加，保留 process.exit() 前的输出。原有输出流及其回调照常工作。
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    writeLog(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return write(chunk, encoding, callback);
  };
}

// 记录模块加载等未捕获的错误，保留 Node 默认的失败退出行为。
process.on('uncaughtExceptionMonitor', (error) => writeLog(`${error?.stack || error}\n`));
process.on('exit', (code) => lifecycle(`麦田守护进程退出（状态 ${code}）`));
