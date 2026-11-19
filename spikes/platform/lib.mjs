// 探针共用：账号表、space 定位、脱敏、原始响应落 scratch/。
// 在 ego-browser 的 Node 运行时里被 import，SDK 全局（taskSpace、listTaskSpaces…）通过 globalThis 取。
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

export const PROFILE = 'Profile 5';

export const ACCOUNTS = [
  { code: 'Douyin', uid: '106707338905', home: 'https://creator.douyin.com/creator-micro/home' },
  { code: 'XiaoHongShu', uid: '5944af205e87e701889da649', home: 'https://creator.xiaohongshu.com/new/home' },
  { code: 'Bili', uid: '478358005', home: 'https://member.bilibili.com/platform/home' },
  { code: 'GongZhongHao', uid: 'gh_eb2c407bc687', home: 'https://mp.weixin.qq.com/' },
  { code: 'Weibo', uid: '2272770294', home: 'https://weibo.com/' },
  { code: 'Channels', uid: 'pending', home: 'https://channels.weixin.qq.com/platform' },
  { code: 'X', uid: 'pending', home: 'https://x.com/home' },
  { code: 'YouTube', uid: 'pending', home: 'https://studio.youtube.com/' },
  { code: 'Instagram', uid: 'pending', home: 'https://www.instagram.com/' },
  // 知识站（麦田 zsz）：后台地址在 config.json 的 site.admin，本机没配，先不开页面
  { code: 'Zhishi', uid: 'pending', home: null },
];

export const spaceName = (a) => `kinso/${a.code}/${a.uid}`;
export const account = (code) => ACCOUNTS.find((a) => a.code === code);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 第三方昵称、uid → user_<sha256 前 8 位>；正文换成 <已脱敏>
export const anon = (s) => (s == null || s === '' ? s : `user_${createHash('sha256').update(String(s)).digest('hex').slice(0, 8)}`);
// 第三方正文（评论、私信内容）一律不留，只标明有没有内容（与 07-engage.md 的说明一致）
export const clip = (s) => (s == null || s === '' ? s : '<已脱敏>');

// 找同名 space 复用，没有才在 Profile 5 建。交给用户的不抢。
// opts.takeOver：space 交给用户扫码后，复测脚本收回控制（只在用户说扫完之后用）
export async function openSpace(a, opts = {}) {
  const name = spaceName(a);
  const found = (await globalThis.listTaskSpaces()).find((s) => s.name === name);
  const prof = found?.profileId ?? found?.profile;
  if (found && prof && prof !== PROFILE) throw new Error(`${name} 在 ${prof}，不是 ${PROFILE}`);
  if (found?.ownership === 'agentDelegatedToUser' && opts.takeOver) {
    const task = await globalThis.takeOverTaskSpace(found.id);
    return { name, id: found.id, task, state: 'agent', created: false };
  }
  if (found?.ownership === 'agentDelegatedToUser') return { name, id: found.id, task: null, state: 'awaiting_user', created: false };
  if (found?.ownership === 'user') return { name, id: found.id, task: null, state: 'user_owned', created: false };
  const task = found ? await globalThis.taskSpace(found.id) : await globalThis.taskSpace(name, { profileId: PROFILE });
  return { name, id: task.spaceId, task, state: 'agent', created: !found };
}

// space 里第一个受管页面；没有就收养第一个 tab，再没有就新开
export async function mainPage(task) {
  const pages = await task.pages();
  if (pages[0]) return pages[0];
  const tab = (await task.tabs())[0];
  if (tab && !tab.label && tab.openedBy !== 'unknown') return task.adopt(tab.page);
  return task.newPage();
}

export async function pageFor(task, label) {
  const pages = await task.pages();
  return pages.find((p) => p.label === label) ?? null;
}

export async function getJson(page, url, opts = {}) {
  const r = await page.fetch(url, { timeout: 15000, ...opts });
  let json = null;
  try { json = JSON.parse(r.body); } catch {}
  return { status: r.status, json, text: json ? null : String(r.body).slice(0, 200) };
}

export async function saveRaw(name, data) {
  const dir = `${globalThis.SPIKE_ROOT}/scratch`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(file, JSON.stringify(data, null, 2));
  return file;
}

// 挂钩页面自己发的 fetch/XHR（只读：只把 JSON 响应抄一份到 window.__spikeCap），之后 goto 的新文档生效
const HOOK = `(()=>{if(window.__spikeCap)return;const cap=window.__spikeCap=[];const MAX=400000;
const keep=(url,text)=>{try{if(!text||text[0]!=='{'&&text[0]!=='[')return;cap.push({url:String(url),t:Date.now(),body:text.length>MAX?text.slice(0,MAX):text});if(cap.length>200)cap.shift()}catch(e){}};
const of=window.fetch;window.fetch=function(...a){return of.apply(this,a).then(r=>{try{const u=typeof a[0]==='string'?a[0]:a[0]&&a[0].url;r.clone().text().then(t=>keep(u,t)).catch(()=>{})}catch(e){};return r})};
const oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u,...r){this.__u=u;return oo.call(this,m,u,...r)};
XMLHttpRequest.prototype.send=function(...a){this.addEventListener('load',()=>{try{if(this.responseType===''||this.responseType==='text')keep(this.__u,this.responseText);else if(this.responseType==='json')keep(this.__u,JSON.stringify(this.response))}catch(e){}});return os.apply(this,a)}})()`;

export async function installHook(page) {
  await page.cdp('Page.enable', {});
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
}

// 读回抓到的响应：[{url, json}]；filter 是 URL 正则源码
export async function captured(page, filter = '.') {
  const list = await page.evaluate((f) => (window.__spikeCap || []).filter((c) => new RegExp(f).test(c.url)), filter);
  return list.map((c) => { let json = null; try { json = JSON.parse(c.body); } catch {} return { url: c.url, json }; });
}

export const pathOnly = (u) => { try { const x = new URL(u, 'https://x.invalid'); return x.pathname; } catch { return String(u).split('?')[0]; } };

// 提交用的脱敏样例：数组只留前 n 条；凭据类键整段去掉；URL 去掉查询串（签名、xsec_token、过期参数都在里面）
const SECRET_KEY = /cookie|token|sign|xsec|bogus|phone|mobile|passport|ticket|session|auth_key|encfilekey|fingerprint|csrf/i;
export function scrub(v, n = 2) {
  if (Array.isArray(v)) return v.slice(0, n).map((x) => scrub(x, n));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '<去掉>' : scrub(x, n);
    return o;
  }
  // 字符串里任何位置的 URL（包括嵌在 JSON 字符串里的）都去掉查询串
  if (typeof v === 'string') return v.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/g, '$1?<查询串去掉>');
  return v;
}

export async function saveSample(name, data) {
  const dir = `${globalThis.SPIKE_ROOT}/spikes/results/samples`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/${name}.json`;
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

// 平台时间 → 目标格式的 postTime：东八区本地时间 "YYYY-MM-DD HH:mm:ss"（小V猫导出就是这个格式）
export const cst = (sec) => (sec ? new Date(sec * 1000 + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) : null);
export const DAY = 86400;

// 递归列出对象里的键路径（只要名字，不要值），用来找字段来源
export function keyPaths(obj, prefix = '', depth = 0, out = new Set()) {
  if (obj == null || typeof obj !== 'object' || depth > 5) return out;
  if (Array.isArray(obj)) { if (obj.length) keyPaths(obj[0], `${prefix}[]`, depth + 1, out); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    keyPaths(v, p, depth + 1, out);
  }
  return out;
}
