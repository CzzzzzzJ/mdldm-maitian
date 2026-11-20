// 系统页更新使用与账号设置相同的文件锁，基于锁内读到的最新配置打补丁。
import path from 'node:path';
import { config, updateConfig, validateWebhook } from './feishu.mjs';
import { PLATFORM_NAMES, accountsOf, configuredPlatforms, setPlatformSelection } from './targets.mjs';

function fieldsOnly(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('设置字段无效');
}
export function applyFeishuPatch(cfg, patch = {}) {
  fieldsOnly(patch, ['webhook', 'login']);
  if ((patch.login !== undefined && typeof patch.login !== 'boolean') || (patch.webhook !== undefined && typeof patch.webhook !== 'string')) throw new Error('飞书设置格式无效');
  const hook = patch.webhook === undefined ? cfg.feishuWebhook || '' : patch.webhook.trim();
  const login = patch.login ?? (cfg.web?.login === 'feishu');
  if (login && !hook) throw new Error('开启飞书验证码登录前先填 webhook');
  if (patch.webhook !== undefined) {
    if (hook) validateWebhook(hook);
    cfg.feishuWebhook = hook;
  }
  if (patch.login === true) cfg.web = { ...cfg.web, login: 'feishu' };
  else if (patch.login === false && cfg.web?.login === 'feishu') delete cfg.web.login;
  return { configured: !!hook, login };
}
export const saveFeishu = patch => updateConfig(next => applyFeishuPatch(next, patch));

function selectPlatform(cfg, id, on) {
  const current = new Set(configuredPlatforms(cfg));
  if (on) current.add(id); else current.delete(id);
  setPlatformSelection(cfg, [...current]);
}
export function setPlatformEnabled(id, on) {
  if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('平台设置无效');
  return updateConfig(next => {
    if (id === 'bilibili' || id.startsWith('bilibili@')) {
      const accounts = accountsOf(next), current = accounts.filter(a => !a.removed);
      const account = current.find(a => (a.id === 'default' ? 'bilibili' : `bilibili@${a.id}`) === id);
      if (!account) throw new Error('未知 B站账号');
      if (on && !configuredPlatforms(next).includes('bilibili')) {
        if (current.length > 1) throw new Error('请先在平台设置中开启 B站总开关，再启用该账号');
        selectPlatform(next, 'bilibili', true);
      }
      if (on && account.id !== 'default' && (process.env.HUB_DRIVER || next.driver) === 'plugin') throw new Error('B站多账号需要 direct 模式');
      account.enabled = on;
      next.bilibiliAccounts = accounts;
    } else {
      if (!Object.hasOwn(PLATFORM_NAMES, id) || id === 'zsz') throw new Error('平台设置无效');
      selectPlatform(next, id, on);
    }
    const active = configuredPlatforms(next);
    const disabled = Object.keys(PLATFORM_NAMES).filter(platform => platform !== 'zsz' && platform !== 'bilibili' && !active.includes(platform));
    for (const a of accountsOf(next)) if (!a.removed && (!a.enabled || !active.includes('bilibili'))) disabled.push(a.id === 'default' ? 'bilibili' : `bilibili@${a.id}`);
    return { ok: true, disabled };
  });
}

const SITE_DEFAULTS = { name: '知识站', base: '', adminPath: '/admin', coursesApi: '/api/courses?admin=1', dashboardApi: '/api/admin/dashboard', coursePath: '/series/{seriesId}?courseId={id}', logo: '' };
function validateSiteFields(site, changed) {
  if (site.enabled && !site.base) throw new Error('先填站点地址再启用');
  if (site.base) {
    let url;
    try { url = new URL(site.base); } catch { throw new Error('站点地址无效'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写不含凭证的 HTTP 或 HTTPS 站点地址');
  }
  for (const key of ['adminPath', 'coursesApi', 'dashboardApi', 'coursePath']) {
    const value = site[key];
    if (value && (!/^\/(?!\/)/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value))) throw new Error('管理与接口路径须以单个 / 开头，且位于同一站点');
  }
  if (changed.logo && site.logo && (path.isAbsolute(site.logo) || /[\\\u0000-\u001f\u007f]/.test(site.logo) ||
      site.logo.split('/').includes('..') || !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(site.logo))) throw new Error('请填写麦田目录内的图片路径');
}
export function applySitePatch(cfg, patch = {}) {
  const prev = cfg.site || {};
  fieldsOnly(patch, ['enabled', ...Object.keys(SITE_DEFAULTS)]);
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('站点启用状态无效');
  const site = { ...prev, enabled: patch.enabled ?? (prev.enabled !== false) };
  for (const [key, dflt] of Object.entries(SITE_DEFAULTS)) {
    if (patch[key] !== undefined && typeof patch[key] !== 'string') throw new Error('站点配置格式无效');
    site[key] = patch[key] === undefined ? (prev[key] ?? dflt) : patch[key].trim();
  }
  validateSiteFields(site, patch);
  cfg.site = site;
  if (patch.enabled !== undefined) selectPlatform(cfg, 'zsz', site.enabled);
  return site;
}
export const saveSite = patch => updateConfig(next => { applySitePatch(next, patch); });

// 用专用 Chrome 的登录态读取数据；测试不会落库。
const dayStr = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
export async function testSite(fields = {}) {
  try {
    const testConfig = { site: config.site };
    const site = applySitePatch(testConfig, { ...fields, enabled: true });
    const admin = site.base.replace(/\/$/, '') + (site.adminPath || '/admin');
    const api = site.dashboardApi || '/api/admin/dashboard';
    const drv = await import('./driver.mjs');
    const origin = new URL(site.base).origin;
    const d = await drv.withTab(admin, t => drv.evaluate(t, `location.origin === ${JSON.stringify(origin)} && fetch(${JSON.stringify(api)},{credentials:'same-origin',redirect:'error'}).then(r=>r.ok?r.json():null).then(x=>x&&({reg:x.registrationTrend,rev:x.revenueTrend}))`), { wait: 8000 });
    if (!Array.isArray(d?.reg) || !Array.isArray(d?.rev)) return { ok: false, error: '知识站后台数据格式无效，请检查管理员登录和接口地址' };
    const today = dayStr(Date.now()), cut = dayStr(Date.now() - 6 * 86400e3);
    const in7 = row => String(row.date || '').slice(0, 10) >= cut && String(row.date || '').slice(0, 10) <= today;
    const reg = d.reg.filter(in7).reduce((sum, row) => sum + Number(row.count || 0), 0);
    const revenue = d.rev.filter(in7).reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    if (!Number.isFinite(reg) || !Number.isFinite(revenue)) throw new Error('知识站后台数据格式无效');
    return { ok: true, summary: { reg, revenue } };
  } catch (e) { return { ok: false, error: String(e.message).replace(/https?:\/\/[^\s]+/g, '[地址已省略]').slice(0, 200) }; }
}
