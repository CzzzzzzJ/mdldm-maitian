// egolite 的直连驱动：用调试端口实现插件代码依赖的那几个 chrome.* 接口，
// 这样 howieip-studio 发布助手（插件）lib 下的适配器不用改就能在中控进程里跑。
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { config } from './feishu.mjs';

const PORT = config.chromePort || 9333;
const EGO_BIN = '/Applications/ego lite.app/Contents/MacOS/ego lite';
const EGO_PROFILE = path.join(os.homedir(), 'Library/Application Support/Citro Labs/ego lite');
const HAS_EGO = process.platform === 'darwin' && fs.existsSync(EGO_BIN);
const expand = (p) => p.replace(/^~(?=\/|$)/, os.homedir());
export const PROFILE = expand(config.chromeProfile || (HAS_EGO && fs.existsSync(EGO_PROFILE) ? EGO_PROFILE : '~/publish-hub/chrome-profile'));
const BIN = process.platform === 'win32'
  ? (['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')].find(p => fs.existsSync(p)) || 'chrome.exe')
  : (HAS_EGO ? EGO_BIN : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const listenerPid = () => { try { return execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0]; } catch { return ''; } };
const commandOf = (pid) => { try { return pid ? execFileSync('ps', ['-p', pid, '-o', 'args='], { stdio: ['ignore', 'pipe', 'ignore'] }).toString() : ''; } catch { return ''; } };
const isEgo = (cmd) => cmd.includes('/ego lite.app/Contents/MacOS/ego lite') && !cmd.includes('Helper');
function egoRunning() {
  try { return execFileSync('ps', ['-ax', '-o', 'command='], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').some(isEgo); } catch { return false; }
}

let ws = null, seq = 0;
const waiting = new Map();            // id -> {resolve, reject}
const tabs = new Map();               // tabId -> {targetId, sessionId}
const byTarget = new Map();           // targetId -> tabId
let nextTab = 1000;

const version = () => fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());

// 启动 egolite（调试端口已经是它就直接用）。端口被别的浏览器占着，或 egolite 没开调试端口时，先退出再带端口拉起。
export async function launchChrome({ foreground = false } = {}) {
  let pid = listenerPid();
  if (pid && HAS_EGO && !isEgo(commandOf(pid))) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch { /* 只结束占着端口的那个进程 */ }
    for (let i = 0; i < 20 && listenerPid() === pid; i++) await sleep(250);
    if (listenerPid() === pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* 已经退出 */ } }
    for (let i = 0; i < 20 && listenerPid(); i++) await sleep(250);
    pid = listenerPid();
  }
  if (!pid || (HAS_EGO && !isEgo(commandOf(pid)))) {
    if (HAS_EGO && egoRunning()) {
      try { execFileSync('osascript', ['-e', 'quit app "ego lite"'], { stdio: 'ignore' }); } catch { /* 接着等进程退出 */ }
      for (let i = 0; i < 80 && egoRunning(); i++) await sleep(250);
      if (egoRunning()) {
        try {
          for (const line of execFileSync('ps', ['-ax', '-o', 'pid=,command='], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')) {
            if (!isEgo(line)) continue;
            const n = Number(line.trim().split(/\s+/)[0]);
            if (n) process.kill(n, 'SIGTERM');
          }
        } catch { /* 下面再确认一次 */ }
        for (let i = 0; i < 40 && egoRunning(); i++) await sleep(250);
      }
      if (egoRunning()) throw new Error('egolite 还在运行，没能带上调试端口重新打开');
    }
    fs.mkdirSync(PROFILE, { recursive: true });
    const args = [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
    const child = HAS_EGO ? spawn('open', ['-a', 'ego lite', '--args', ...args], { detached: true, stdio: 'ignore' }) : spawn(BIN, args, { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 40; i++) { await sleep(500); try { await version(); break; } catch { if (i === 39) throw new Error('egolite 没启动起来'); } }
  }
  if (HAS_EGO && !isEgo(commandOf(listenerPid()))) throw new Error('9333 端口不是 egolite');
  if (foreground) { try { execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${listenerPid()}) to true`]); } catch { /* 不影响 */ } }
}

let connecting = null;
function connect() {
  if (ws && ws.readyState === 1) return Promise.resolve();
  return (connecting ||= doConnect().finally(() => { connecting = null; }));
}
async function doConnect() {
  await launchChrome();
  const v = await version();
  const sock = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error('连不上egolite 的调试端口')); });
  ws = sock;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
      return;
    }
    // 「离开此网站？」等弹窗：自动点离开，不让它卡住浏览器
    if (m.method === 'Page.javascriptDialogOpening' && m.sessionId) raw('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch(() => {});
    if (m.method === 'Target.targetDestroyed') { const t = byTarget.get(m.params.targetId); if (t) { tabs.delete(t); byTarget.delete(m.params.targetId); } }
  };
  ws.onclose = () => { ws = null; for (const w of waiting.values()) w.reject(new Error('egolite 断开了')); waiting.clear(); tabs.clear(); byTarget.clear(); };
  await raw('Target.setDiscoverTargets', { discover: true });
}
function raw(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); reject(new Error(`${method} 超时`)); } }, 180000).unref();
  });
}
function tabOf(id) { const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return t; }
async function session(id) {
  const t = tabOf(id);
  if (!t.sessionId) {
    t.sessionId = (await raw('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
    await raw('Page.enable', {}, t.sessionId).catch(() => {});
  }
  return t.sessionId;
}

export const chrome = {
  runtime: { id: 'publish-hub' },
  scripting: { executeScript: async () => { throw new Error('egolite 里不支持 scripting'); } },
  tabs: {
    async create({ url, active = false }) {
      await connect();
      const { targetId } = await raw('Target.createTarget', { url: url || 'about:blank', background: !active });
      const id = nextTab++; tabs.set(id, { targetId }); byTarget.set(targetId, id);
      return { id, url, windowId: 1 };
    },
    async get(id) {
      await connect();
      const { targetInfo } = await raw('Target.getTargetInfo', { targetId: tabOf(id).targetId });
      return { id, url: targetInfo.url, title: targetInfo.title, windowId: 1 };
    },
    async query() { return []; },
    async update(id, { active } = {}) { await connect(); if (active) await raw('Target.activateTarget', { targetId: tabOf(id).targetId }); return { id }; },
    async remove(ids) {
      await connect();
      for (const id of [].concat(ids)) { const t = tabs.get(id); if (!t) continue; await session(id).catch(() => {}); await raw('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); }
    },
  },
  debugger: {
    onDetach: { addListener() {} },
    async attach({ tabId }) { await connect(); await session(tabId); },
    async detach() { /* 会话留着，后面的回读和提交还要用 */ },
    async sendCommand({ tabId }, method, params = {}) { await connect(); return raw(method, params, await session(tabId)); },
  },
};
// 认领egolite 里已经开着的页面（别的进程填好的发帖页），返回本进程可用的 tabId
export async function adoptTargets(re) {
  await connect();
  const { targetInfos } = await raw('Target.getTargets');
  return targetInfos.filter(t => t.type === 'page' && re.test(t.url)).map(t => {
    let id = byTarget.get(t.targetId);
    if (id == null) { id = nextTab++; tabs.set(id, { targetId: t.targetId }); byTarget.set(t.targetId, id); }
    return id;
  });
}
export function closeConnection() { if (ws) { ws.onclose = null; ws.close(); ws = null; } }
