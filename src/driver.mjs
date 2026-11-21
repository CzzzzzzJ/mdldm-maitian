// 驱动选择：direct = 中控直连专用 Chrome（默认）；plugin = 通过插件面板的开发桥
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, bindBilibiliAccount } from './feishu.mjs';
import { getTarget } from './targets.mjs';
import * as bridge from './bridge.mjs';
import * as shim from './chrome-shim.mjs';
import { pluginDir, pluginInfo } from './plugin.mjs';

export const mode = (process.env.HUB_DRIVER || config.driver || 'direct');
export const sleep = bridge.sleep;
let lib = null, loading = null;   // 插件的 publish.js / cdp.js（direct 模式下在本进程里加载）
async function load() {
  if (lib) return lib;
  return (loading ||= loadDirect().finally(() => { loading = null; }));
}
async function loadDirect() {
  globalThis.chrome = shim.chrome;
  const dir = pluginDir();
  const pub = await import(pathToFileURL(path.join(dir, 'lib/publish.js')).href);
  const cdp = await import(pathToFileURL(path.join(dir, 'lib/cdp.js')).href);
  return (lib = { shim, pub, cdp });
}

export async function ensure({ launch = true } = {}) {
  if (mode === 'plugin') return bridge.ensureBridge();
  await load();
  if (launch) await shim.launchChrome();
}

// 读取登录接口返回的真实身份；不能用可手动修改的 DedeUserID Cookie 绑定账号。
async function verifyBilibili(target) {
  const expr = `(()=>{try{const x=JSON.parse((document.querySelector('pre')||document.body).textContent);return x.code===0&&x.data&&x.data.isLogin?{uid:String(x.data.mid),name:x.data.uname}:{uid:''}}catch{return null}})()`;
  const identity = await withTab('https://api.bilibili.com/x/web-interface/nav', async (tabId) => {
    if (mode !== 'plugin') return (await load()).cdp.waitFor(tabId, expr, 15000, 250);
    return bridge.evaluate(tabId, expr);
  }, { wait: mode === 'plugin' ? 2000 : 0 });
  if (!identity || !/^\d+$/.test(identity.uid)) throw new Error(`${target.name}没有登录，请先打开该账号登录`);
  await bindBilibiliAccount(target.accountId || 'default', identity.uid, identity.name);
  return identity;
}
export async function withTarget(id, fn, { verify = false } = {}) {
  const target = getTarget(config, id);
  if (mode === 'plugin') {
    if (target.accountId && target.accountId !== 'default') throw new Error('B站多账号需要 direct 模式');
    if (verify && target.platform === 'bilibili') await verifyBilibili(target);
    return fn(target);
  }
  return shim.withBrowser(target, async () => {
    if (verify && target.platform === 'bilibili') await verifyBilibili(target);
    return fn(target);
  });
}

function groups(ids) {
  const out = new Map();
  for (const id of ids) {
    const t = getTarget(config, id), key = `${t.chromePort}\0${t.chromeProfile}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(t);
  }
  return [...out.values()];
}
export async function evaluate(tabId, expr, timeout) { if (mode === 'plugin') return bridge.evaluate(tabId, expr, timeout); return (await load()).cdp.evaluate(tabId, expr); }
// 真实鼠标点击（直连模式用插件 cdp.js 的 click；开发桥模式退回元素 .click()）
export async function click(tabId, expr) {
  if (mode === 'plugin') return bridge.evaluate(tabId, `(()=>{const e=${expr};if(!e)return false;e.click();return true})()`);
  return (await load()).cdp.click(tabId, expr);
}
// 认领已开着的页面（hub submit 用）；插件方式不支持
export async function adoptTabs(re) { if (mode === 'plugin') throw new Error('插件方式不支持认领页面，请用专用 Chrome（driver: direct）'); return (await load()).shim.adoptTargets(re); }
export async function withTab(url, fn, { wait = 8000 } = {}) {
  if (mode === 'plugin') return bridge.withTab(url, fn, { wait });
  await load(); const t = await chrome.tabs.create({ url, active: false });
  try { await sleep(wait); return await fn(t.id); } finally { await chrome.tabs.remove(t.id).catch(() => {}); }
}
export async function busy() { if (mode !== 'plugin') return false; const j = await bridge.panel('job', [], 30000); return !!(j && j.running); }

// 商店里的插件版本还没有某个平台的适配器（比如新平台刚加、商店还在审核）：这几个平台先跳过并说明
const split = (pub, ids) => [ids.filter(id => pub.ADAPTERS[id]), ids.filter(id => !pub.ADAPTERS[id])];
const tooOld = (id) => { const p = pluginInfo(); return `麦田发布助手 ${p.version || ''}（${p.source === 'store' ? '商店版' : '本地'}）还不支持 ${id}，等插件更新`; };
async function readyTargets(targets, onFailure) {
  const pub = mode === 'plugin' ? null : (await load()).pub;
  const active = [];
  for (const target of targets) {
    if (pub && !pub.ADAPTERS?.[target.platform]) {
      onFailure(target, new Error(tooOld(target.platform)), '异常');
      continue;
    }
    try {
      if (target.platform === 'bilibili') await withTarget(target.id, () => {}, { verify: true });
      active.push(target);
    } catch (e) { onFailure(target, e, '未登录'); }
  }
  return active;
}

// 跑一批平台；onState(st) 在每次状态变化时调用，st = {id, status, logs, tabId}
export async function runBatch(project, batch, onState, onStall) {
  if (mode !== 'plugin') {
    const { pub } = await load();
    const [ok, missing] = split(pub, batch);
    const gone = missing.map(id => ({ id, status: '异常', logs: [{ kind: 'err', msg: tooOld(id) }] }));
    gone.forEach(onState);
    if (!ok.length) return gone;
    const states = await pub.run(project, { rootPath: config.rootPath, platforms: ok, onChange: (st) => onState(st), shouldStop: () => false });
    return [...Object.values(states), ...gone];
  }
  const r = await bridge.panel('startRaw', [project, batch, config.rootPath]);
  if (!r || !r.ok) throw new Error(`插件没能开始：${r ? r.error : '没有响应'}`);
  for (let miss = 0, warned = false; ;) {
    await sleep(20000);
    let j; try { j = await bridge.panel('job', [], 30000); miss = 0; } catch { miss++; }
    if (miss >= 6 && !warned) { warned = true; onStall && onStall(); }
    if (!j) continue;
    const st = Array.isArray(j.states) ? j.states : Object.values(j.states || {});
    for (const s of st) if (batch.includes(s.id)) onState(s);
    if (!j.running) return st;
  }
}
export async function checkLogin(ids) {
  if (mode === 'plugin') { const r = await bridge.panel('checkLogin', [ids], 120000); return r && r.ok ? r.result : {}; }
  const { pub } = await load(); const [ok, missing] = split(pub, ids);
  const r = ok.length ? await pub.preflight(ok, { keepTabs: false }) : {};
  for (const id of missing) r[id] = { ok: false, reason: tooOld(id) };
  return r;
}
export async function checkAccountLogins(ids) {
  const out = {};
  for (const targets of groups(ids)) {
    const active = await readyTargets(targets, (target, error, status) => {
      out[target.id] = { ok: false, reason: error.message, ...(status === '异常' && { unavailable: true }) };
    });
    if (!active.length) continue;
    await withTarget(active[0].id, async () => {
      const baseIds = active.map(t => t.platform);
      const result = mode === 'plugin' ? await bridge.panel('checkLogin', [baseIds], 120000).then(r => r && r.ok ? r.result : {}) : await (await load()).pub.preflight(baseIds, { keepTabs: false });
      for (const t of active) out[t.id] = result[t.platform] || { ok: false, reason: '没有检查结果' };
    });
  }
  return out;
}
export async function links(project, ids) {
  if (mode === 'plugin') { const r = await bridge.panel('links', [project, ids], 600000); if (!r || !r.ok) throw new Error(r ? r.error : '没有响应'); return r.result; }
  return (await load()).pub.collectLinks(project, ids, {});
}
export async function openForLogin(urls) {
  await shim.launchChrome({ foreground: true });
  for (const url of urls) await shim.chrome.tabs.create({ url, active: true });
}
export async function openAccountLogin(id) {
  return withTarget(id, async (target) => {
    if (target.platform !== 'bilibili') throw new Error('请选择 B站账号');
    if (mode === 'plugin') { await bridge.ensureBridge(); return bridge.call({ op: 'open', url: 'https://member.bilibili.com/' }); }
    await openForLogin(['https://member.bilibili.com/']);
  });
}
export async function checkAccount(id) {
  return withTarget(id, async (target) => {
    if (target.platform !== 'bilibili') throw new Error('请选择 B站账号');
    return { ok: true, ...await verifyBilibili(target) };
  });
}
export async function close() { shim.closeConnection(); }
// 页面截图（存档用），返回 JPEG Buffer
export async function screenshot(tabId) {
  const params = { format: 'jpeg', quality: 70 };
  const r = mode === 'plugin' ? await bridge.call({ op: 'cdp', tabId, method: 'Page.captureScreenshot', params }) : await (await load()).cdp.send(tabId, 'Page.captureScreenshot', params);
  return Buffer.from(r.data, 'base64');
}
