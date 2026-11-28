// 集成配置管理：飞书群机器人、自定义知识站的合并 / 保存 / 测试。
// 另外提供独立的 B 站采集账号配置接口，不改发布设置。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSchedules, notifyScheduleChange } from './schedules.mjs';
import { accountsOf } from './targets.mjs';
import { config, CFG } from './feishu.mjs';
import * as drv from './driver.mjs';

// ---------- 飞书 ----------
export function applyFeishuPatch(config, { webhook = '', login = false } = {}) {
  const hook = String(webhook || '').trim();
  // 飞书验证码登录靠 webhook 发码：没有 webhook 还开着登录，远程就再也登不进来
  if (login && !hook) throw new Error('开启飞书验证码登录前先填 webhook');
  config.feishuWebhook = hook;
  if (login) config.web = { ...(config.web || {}), login: 'feishu' };
  else if (config.web) delete config.web.login;
  return { webhook: config.feishuWebhook, login: !!(config.web && config.web.login === 'feishu') };
}

// ---------- 知识站 ----------
const SITE_DEFAULTS = { name: '知识站', adminPath: '/admin', coursesApi: '/api/courses?admin=1', dashboardApi: '/api/admin/dashboard', coursePath: '/series/{seriesId}?courseId={id}', logo: '' };
export function applySitePatch(config, p = {}) {
  const prev = config.site || {};
  if (prev.provider === 'xiaoe') {
    config.site = { ...prev, enabled: p.enabled === undefined ? prev.enabled !== false : !!p.enabled };
    return config.site;
  }
  const pick = (key, dflt) => p[key] !== undefined && p[key] !== null ? String(p[key]) : (prev[key] !== undefined && prev[key] !== null ? String(prev[key]) : dflt);
  const site = {
    enabled: p.enabled !== undefined ? !!p.enabled : (prev.enabled !== false),
    name: pick('name', SITE_DEFAULTS.name),
    base: pick('base', ''),
    adminPath: pick('adminPath', SITE_DEFAULTS.adminPath),
    coursesApi: pick('coursesApi', SITE_DEFAULTS.coursesApi),
    dashboardApi: pick('dashboardApi', SITE_DEFAULTS.dashboardApi),
    coursePath: pick('coursePath', SITE_DEFAULTS.coursePath),
    logo: pick('logo', SITE_DEFAULTS.logo),
  };
  // 启用时必须有站点地址；停用可以空着
  if (site.enabled && !String(site.base || '').trim()) throw new Error('先填站点地址再启用');
  config.site = site;
  return site;
}

// 写回 config.json；失败抛错（调用方负责回滚内存）
export function saveConfig(config) {
  fs.copyFileSync(CFG, CFG + '.bak');
  fs.writeFileSync(CFG, JSON.stringify(config, null, 2) + '\n');
}

// ---------- B 站采集账号 ----------
export class InvalidBilibiliAccounts extends Error {}
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function bilibiliAccountView(cfg = config) {
  return accountsOf(cfg).filter(a => !a.removed).map(({ id, name, uid, enabled }) => ({ id, name, uid, enabled }));
}

// Historical bindings are read only when editing accounts. The traffic collector
// may already know an account's UID even when its config has no UID.
function historicalBindings(db) {
  const ids = new Map();
  if (!db) return ids;
  const rows = db.prepare("SELECT platform,uid FROM account_traffic_identity WHERE platform='bilibili' OR platform GLOB 'bilibili@*'").all();
  for (const { platform, uid } of rows) ids.set(platform === 'bilibili' ? 'default' : platform.slice(9), uid);
  return ids;
}

export function replaceBilibiliAccounts(cfg, body, bindings = new Map()) {
  const fields = ['id', 'name', 'uid', 'enabled'];
  if (!isObject(body) || body.action !== 'replace' || Object.keys(body).some(k => !['action','bilibiliAccounts','expectedAccounts'].includes(k)) || !Array.isArray(body.bilibiliAccounts)) throw new InvalidBilibiliAccounts('账号设置格式无效');
  if (body.expectedAccounts !== undefined && !isDeepStrictEqual(body.expectedAccounts, bilibiliAccountView(cfg))) {
    throw Object.assign(new InvalidBilibiliAccounts('账号设置已变化，请刷新后再保存'), { status: 409 });
  }
  const old = cfg.bilibiliAccounts ?? [];
  if (!Array.isArray(old) || old.some(a => !isObject(a))) throw new InvalidBilibiliAccounts('现有账号设置无效，请检查 config.json');
  const previous = new Map(old.map(a => [a.id, a]));
  const removedByUid = new Map(old.filter(a => a.removed).map(a => [a.uid || bindings.get(a.id), a]));
  const historicalOwner = new Map([...bindings].map(([id, uid]) => [uid, id]));
  const ids = new Set();
  const next = body.bilibiliAccounts.map(a => {
    if (!isObject(a) || Object.keys(a).some(k => !fields.includes(k)) || typeof a.id !== 'string' || typeof a.name !== 'string' || !a.name.trim() || typeof a.uid !== 'string' || (a.enabled !== undefined && typeof a.enabled !== 'boolean')) throw new InvalidBilibiliAccounts('B站账号字段无效');
    const restore = !a.id && a.uid && removedByUid.get(a.uid);
    const before = previous.get(a.id) || restore;
    const id = before?.id || a.id || 'a' + randomUUID().replaceAll('-', '');
    if (ids.has(id)) throw new InvalidBilibiliAccounts('B站账号重复');
    ids.add(id);
    const historicalUid = bindings.get(id);
    if (historicalOwner.has(a.uid) && historicalOwner.get(a.uid) !== id) throw new InvalidBilibiliAccounts('B站账号 UID 已绑定到其他账号');
    const changed = a.uid !== (before?.uid || '');
    if ((changed && historicalUid && a.uid !== historicalUid) || (before?.removed && before.uid && changed)) {
      throw new InvalidBilibiliAccounts('B站账号 UID 与原账号不一致');
    }
    const row = { ...before, id, name: a.name.trim(), uid: a.uid, enabled: a.enabled ?? (before?.enabled !== false) };
    delete row.removed;
    return row;
  });
  for (const a of old) {
    if (!ids.has(a.id)) next.push(a.id === 'default' ? a : { ...a, removed: true });
  }
  try { accountsOf({ ...cfg, bilibiliAccounts: next }); }
  catch (e) { throw new InvalidBilibiliAccounts(e.message); }
  return next;
}

function updateSettings(change, backup = false) {
  // 在写入前读取磁盘，保留所有其他设置；同步写入和换名避免同一进程
  // 的并发请求交错，也避免写入失败留下半个 JSON。
  const cfgPath = fs.realpathSync(CFG);
  const disk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const patch = change(disk);
  const updated = { ...disk, ...patch };
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(cfgPath), '.maitian-settings-'));
  const tmpFile = path.join(tmpDir, 'config.json');
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2) + '\n', { mode: fs.statSync(cfgPath).mode & 0o777 });
    if (backup) fs.copyFileSync(cfgPath, cfgPath + '.bak');
    fs.renameSync(tmpFile, cfgPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  Object.assign(config, patch);
  return updated;
}

export function saveBilibiliAccounts(body, db) {
  updateSettings(disk => ({ bilibiliAccounts: replaceBilibiliAccounts(disk, body, historicalBindings(db)) }));
  return { bilibiliAccounts: bilibiliAccountView() };
}

export function setPlatformEnabled(platform, on, platforms, accountId) {
  if (!platforms.includes(platform) || typeof on !== 'boolean') throw new InvalidBilibiliAccounts('平台设置无效');
  if (accountId !== undefined && (platform !== 'bilibili' || typeof accountId !== 'string')) throw new InvalidBilibiliAccounts('B站账号设置无效');
  updateSettings(disk => {
    if (accountId === undefined) {
      const off = new Set(disk.disabled || []);
      // Existing clients toggle the entire platform, including any Bilibili accounts.
      on ? off.delete(platform) : off.add(platform);
      return { disabled: [...off].sort() };
    }
    const accounts = bilibiliAccountView(disk);
    if (!accounts.some(a => a.id === accountId)) throw new InvalidBilibiliAccounts('没有这个 B站账号');
    const records = disk.bilibiliAccounts || [];
    // The default account may be implicit in configurations written before account rows.
    const next = records.some(a => a.id === accountId)
      ? records.map(a => a.id === accountId ? { ...a, enabled: on } : a)
      : [...records, { id: accountId, enabled: on }];
    return { bilibiliAccounts: next };
  }, true);
  return { ok: true, disabled: config.disabled || [] };
}

export function saveSchedules(body) {
  if (!isObject(body?.schedules)) throw Object.assign(new Error('请填写自动调度时间'), { status: 400 });
  let next;
  try { next = normalizeSchedules(body.schedules); }
  catch (err) { throw Object.assign(err, { status: 400 }); }
  updateSettings(disk => {
    if (body.expectedSchedules !== undefined && !isDeepStrictEqual(normalizeSchedules(disk.schedules), body.expectedSchedules)) {
      throw Object.assign(new Error('调度时间已变化，请取消后重新修改'), { status: 409 });
    }
    return { schedules: next };
  }, true);
  notifyScheduleChange();
  return next;
}

// ---------- 测试（只读，用调用方给的字段，不写库） ----------
const dayStr = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
export async function testSite(fields = {}) {
  if (config.site?.provider === 'xiaoe') {
    try {
      const { fetchXiaoe } = await import('./xiaoe.mjs');
      const s = config.site;
      await fetchXiaoe({ shopName: s.shopName, admin: s.base.replace(/\/$/, '') + (s.adminPath || '/t/merchant/index') });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  const base = String(fields.base || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: '先填站点地址' };
  const admin = base + (fields.adminPath || '/admin');
  const api = fields.dashboardApi || '/api/admin/dashboard';
  try {
    const d = await drv.withTab(admin, (t) => drv.evaluate(t, `fetch(${JSON.stringify(api)},{credentials:'include'}).then(r=>r.ok?r.json():null).then(x=>x&&({reg:x.registrationTrend,rev:x.revenueTrend}))`), { wait: 8000 });
    if (!d) return { ok: false, error: '知识站后台数据没读到（管理员登录过期？）' };
    const today = dayStr(Date.now()), cut = dayStr(Date.now() - 6 * 86400e3);
    const in7 = (d0) => { const k = String(d0 || '').slice(0, 10); return k >= cut && k <= today; };
    const reg = (d.reg || []).filter(r => in7(r.date)).reduce((n, r) => n + (r.count || 0), 0);
    const revenue = (d.rev || []).filter(r => in7(r.date)).reduce((n, r) => n + (r.revenue || 0), 0);
    return { ok: true, summary: { reg, revenue } };
  } catch (e) { return { ok: false, error: e.message }; }
}
