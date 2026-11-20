import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { accountsOf, getTargets, enabledPlatforms, setPlatformSelection, settingsView } from './targets.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CFG = process.env.MAITIAN_CONFIG || path.join(ROOT, 'config.json');
if (!fs.existsSync(CFG)) { console.error('还没有 config.json：先运行 node src/init.mjs（安装向导），或者 node src/demo.mjs 用假数据看看效果'); process.exit(1); }
export const config = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const configListeners = new Set();
export const onConfigChange = fn => configListeners.add(fn);
export function reloadConfig() {
  const next = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  getTargets(next);
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, next);
  for (const listener of configListeners) listener();
  return config;
}
function writeConfig(next, backup = false) {
  getTargets(next);
  const tmp = `${CFG}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    if (backup) {
      fs.writeFileSync(tmp, fs.readFileSync(CFG), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, CFG + '.bak');
    }
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, CFG);
  }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  reloadConfig();
}
function withConfigLock(fn) {
  let fd;
  try { fd = fs.openSync(CFG + '.lock', 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('另一个任务正在修改配置，请稍后重试'); throw e; }
  // shortcut: 进程崩溃可能留下锁，确认任务退出后移除 config.json.lock。
  try { fs.writeSync(fd, String(process.pid)); return fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(CFG + '.lock'); }
}
export function saveSettings(body) {
  return withConfigLock(() => {
    if (!body || !Array.isArray(body.enabledPlatforms) || !Array.isArray(body.bilibiliAccounts)) throw new Error('设置格式无效');
    const next = JSON.parse(fs.readFileSync(CFG, 'utf8')), old = accountsOf(next), byId = new Map(old.map(a => [a.id, a]));
    setPlatformSelection(next, body.enabledPlatforms);
    if (next.site && Object.hasOwn(next.site, 'enabled')) next.site.enabled = body.enabledPlatforms.includes('zsz');
    const ids = new Set();
    next.bilibiliAccounts = body.bilibiliAccounts.map(a => {
      if (!a || typeof a !== 'object') throw new Error('B站账号格式无效');
      const id = a.id || `a${randomBytes(6).toString('hex')}`, prev = byId.get(id);
      if ((a.id && !prev) || ids.has(id)) throw new Error('B站账号标识无效或重复');
      if (a.uid && a.uid !== prev?.uid) throw new Error('不能通过设置更换账号 UID，请新增账号');
      ids.add(id);
      return { ...prev, id, name: a.name, enabled: a.enabled, uid: prev?.uid || '', removed: false };
  });
  if (!ids.has('default')) throw new Error('默认账号可停用，不能移除');
  for (const account of old) if (!ids.has(account.id)) next.bilibiliAccounts.push({ ...account, enabled: false, removed: true });
  if ((process.env.HUB_DRIVER || next.driver) === 'plugin' && next.bilibiliAccounts.some(a => a.id !== 'default' && a.enabled !== false)) throw new Error('B站多账号需要 direct 模式');
  next.bilibiliAccounts = accountsOf(next);
  writeConfig(next);
  return settingsView(config);
  });
}
export function updateConfig(patch) {
  return withConfigLock(() => {
    const next = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    const result = patch(next);
    writeConfig(next, true);
    return result;
  });
}
export function bindBilibiliAccount(accountId, uid, nickname) {
  return withConfigLock(() => {
    const next = JSON.parse(fs.readFileSync(CFG, 'utf8')), accounts = accountsOf(next), account = accounts.find(a => a.id === accountId);
    if (!account || !account.enabled || !enabledPlatforms(next).includes('bilibili')) throw new Error('B站账号未启用');
    if (typeof uid !== 'string' || !/^[1-9]\d{0,19}$/.test(uid)) throw new Error('未读到有效的 B站账号 UID');
    if (account.uid && account.uid !== uid) throw new Error(`B站账号身份不符：预期 UID ${account.uid}，当前 ${uid}`);
    const name = typeof nickname === 'string' ? nickname.trim() : '';
    if (name && name.length > 40) throw new Error('B站账号昵称无效');
    if (!account.uid || (name && account.name !== name)) { account.uid = uid; if (name) account.name = name; next.bilibiliAccounts = accounts; writeConfig(next); }
    return uid;
  });
}

// ---------- 文字 → 飞书卡片（2026-11-14） ----------
// 调用方仍然传文字：第一行当标题，开头的表情决定卡片颜色；「平台：状态（说明） 链接」这种行排成带颜色的状态行。
const COLOR = [[/^(✅|🎉)/, 'green'], [/^(👉|⏰)/, 'orange'], [/^❌/, 'red'], [/^⚠️/, 'yellow'], [/^🚀/, 'blue'], [/^(📋|🔗)/, 'wathet'], [/^🩺/, 'turquoise'], [/^(📊|📈)/, 'purple'], [/^🌐/, 'indigo']];
const PLAT = /^(B站|小红书|抖音|视频号|YouTube|X|知识站)：([^（(\s]+)(?:[（(](.*)[)）])?\s*(https?:\/\/\S+)?\s*$/;
const STATE_COLOR = (s) => /已发布|已上线/.test(s) ? 'green' : /已定时|已填好/.test(s) ? 'blue' : /待你点发布/.test(s) ? 'orange' : /异常|未登录|失败/.test(s) ? 'red' : 'grey';
const esc = (s) => String(s).replace(/[<>]/g, (c) => ({ '<': '&lt;', '>': '&gt;' }[c]));
const link = (s) => esc(s).replace(/https?:\/\/[^\s；;，,）)]+/g, (u) => `[${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}${u.length > 50 ? '…' : ''}](${u})`);

function webUrl() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tunnel.json'), 'utf8')).url; } catch { return ''; } }

export function toCard(text) {
  const lines = String(text).split('\n').map((l) => l.trim());
  const head = lines.shift() || '麦田';
  const template = (COLOR.find(([re]) => re.test(head)) || [null, 'blue'])[1];
  // 标题太长（比如「✅ 期名」）：期名放标题，后半句放副标题
  const [title, ...restHead] = head.split(/\s*[|｜]\s*(?=[^|｜]*$)/);
  const elements = [];
  let buf = [], rows = [];
  const flushText = () => { if (buf.length) { elements.push({ tag: 'markdown', content: buf.map(link).join('\n') }); buf = []; } };
  const flushRows = () => {
    if (!rows.length) return;
    elements.push({ tag: 'markdown', content: rows.map(([, p, st, detail, url]) => `**${p}**　<font color='${STATE_COLOR(st)}'>${esc(st)}</font>${detail ? `　<font color='grey'>${esc(detail.length > 46 ? detail.slice(0, 46) + '…' : detail)}</font>` : ''}${url ? `　[打开](${url})` : ''}`).join('\n') });
    rows = [];
  };
  for (const l of lines) {
    if (!l) { flushText(); flushRows(); continue; }
    const m = l.match(PLAT);
    if (m) { flushText(); rows.push(m); } else { flushRows(); buf.push(l); }
  }
  flushText(); flushRows();
  if (!elements.length) elements.push({ tag: 'markdown', content: link(head) });
  const url = webUrl();
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `麦田 · ${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }).slice(5, 16)}` }] });
  if (url) elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开麦田' }, type: 'primary', url }] });
  return { config: { wide_screen_mode: true }, header: { template, title: { tag: 'plain_text', content: title.slice(0, 80) }, ...(restHead.length ? { subtitle: { tag: 'plain_text', content: restHead.join(' ').slice(0, 80) } } : {}) }, elements };
}

async function post(body, webhook = config.feishuWebhook) {
  const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (r.ok === false) throw new Error(`飞书返回 HTTP ${r.status}`);
  return r.json();
}

// 发飞书群消息；卡片发不出去就退回纯文字；失败只打印，不影响主流程
export async function notify(text, { quiet = false } = {}) {
  if (!quiet) console.log(`[飞书] ${text.replace(/\n/g, ' | ')}`);   // quiet：验证码之类的不写日志
  if (!config.feishuWebhook) return;
  try {
    let j = await post({ msg_type: 'interactive', card: toCard(text) });
    if (j.code && j.code !== 0) { console.error('飞书卡片被拒，改发文字：', JSON.stringify(j)); j = await post({ msg_type: 'text', content: { text } }); }
    if (j.code && j.code !== 0) console.error('飞书返回：', JSON.stringify(j));
  } catch (e) { console.error('飞书通知失败：', e.message); }
}

// 系统页「测试发送」：用给定的 webhook 发一条文字消息，返回成功/失败原因
export function validateWebhook(webhook) {
  if (typeof webhook !== 'string' || !/^https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[a-z\d_-]+$/i.test(webhook)) {
    throw new Error('请填写飞书或 Lark 群机器人提供的 HTTPS webhook 地址');
  }
}
export async function testFeishu(webhook) {
  if (!webhook) return { ok: false, error: '先填 webhook' };
  try {
    validateWebhook(webhook);
    const j = await post({ msg_type: 'text', content: { text: '麦田 · 集成测试 ✅\n这是一条从系统页发出的测试消息。' } }, webhook);
    if (!j || typeof j.code !== 'number') return { ok: false, error: '飞书返回的数据格式无效' };
    if (j.code !== 0) return { ok: false, error: `飞书拒绝发送（错误码 ${j.code}）` };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message).replace(/https?:\/\/[^\s]+/g, '[地址已省略]').slice(0, 200) }; }
}
