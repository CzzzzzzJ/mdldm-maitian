// 偏好：能改哪些、默认值和范围在 prefs.json。保存的值写回 config.json，并改内存里的同一份 config，守护进程下一次任务就用新的。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, configPath } from './feishu.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const schema = JSON.parse(fs.readFileSync(path.join(DIR, 'prefs.json'), 'utf8'));
const DATA = path.join(ROOT, 'data');

export function platformIds() { return schema.platforms.map((p) => p.id); }

const known = (id) => platformIds().includes(id);
const underRoot = (f) => { const rel = path.relative(ROOT, path.resolve(f)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
const fileOn = (rel) => {
  if (!rel || typeof rel !== 'string') return false;
  const f = path.resolve(ROOT, rel);
  return underRoot(f) && fs.existsSync(f);
};

function storedList(key) {
  const v = config[key];
  if (!Array.isArray(v)) return schema.defaults[key].filter(known);
  return v.filter(known);
}

export function prefsView() {
  const site = config.site && config.site.base ? config.site : null;
  const hook = typeof config.feishuWebhook === 'string' ? config.feishuWebhook : '';
  const w = config.web || {};
  return {
    platforms: schema.platforms,
    siteFields: schema.siteFields,
    limits: schema.limits,
    owner: typeof w.owner === 'string' ? w.owner : '',
    avatar: fileOn(w.avatar),
    manual: storedList('manual'),
    keepAlive: storedList('keepAlive'),
    keepAliveMinutes: Number.isFinite(+config.keepAliveMinutes) ? +config.keepAliveMinutes : schema.defaults.keepAliveMinutes,
    sampleHours: Number.isFinite(+config.sampleHours) ? +config.sampleHours : schema.defaults.sampleHours,
    site: site ? {
      name: site.name || '',
      base: site.base || '',
      adminPath: site.adminPath || '',
      coursesApi: site.coursesApi || '',
      dashboardApi: site.dashboardApi || '',
      coursePath: site.coursePath || '',
      logo: fileOn(site.logo),
    } : null,
    feishu: { on: !!hook, tail: hook ? hook.slice(-4) : '' },
  };
}

function idList(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label}格式不对`);
  const out = [];
  for (const id of list) {
    if (!known(id) || out.includes(id)) throw new Error(`${label}里有不认识或重复的平台`);
    out.push(id);
  }
  return out;
}

function inRange(n, key, label) {
  const [lo, hi] = schema.limits[key];
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}要在 ${lo} 到 ${hi} 之间`);
  return n;
}

function sitePath(v, def, label) {
  const s = String(v || '').trim() || def;
  if (!s.startsWith('/') || s.includes('..') || /\s/.test(s) || s.length > 200) throw new Error(`${label}要以 / 开头`);
  return s;
}

function cleanSite(site) {
  if (site == null || !String(site.base || '').trim()) return null;
  const baseRaw = String(site.base).trim();
  let u;
  try { u = new URL(baseRaw); } catch { throw new Error('站点地址不对'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('站点地址要用 http 或 https');
  const d = schema.siteDefaults;
  const name = String(site.name || '').trim() || d.name;
  if (name.length > schema.limits.owner) throw new Error('站点名称太长');
  const prev = config.site && typeof config.site === 'object' ? config.site : {};
  return {
    ...prev,
    name,
    base: baseRaw.replace(/\/$/, ''),
    adminPath: sitePath(site.adminPath, d.adminPath, '管理后台路径'),
    coursesApi: sitePath(site.coursesApi, d.coursesApi, '课程列表接口'),
    dashboardApi: sitePath(site.dashboardApi, d.dashboardApi, '数据汇总接口'),
    coursePath: sitePath(site.coursePath, d.coursePath, '课程页路径'),
  };
}

function imageKind(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function decodeImage(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error('图片内容不对');
  const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/.exec(raw);
  const b64 = (m ? m[1] : raw).replace(/\s/g, '');
  const max = schema.limits.imageBytes || 2097152;
  if (b64.length > Math.ceil(max * 4 / 3) + 8) throw new Error('图片超过 2MB');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('图片内容不对');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > max) throw new Error('图片超过 2MB');
  if (!imageKind(buf)) throw new Error('只接受 jpg、png、webp');
  return buf;
}

// 转成临时文件，调用方再改名到目标路径。校验失败时还没写到 data/。
export function convertImage(buf, dest, format) {
  const max = schema.limits.imageBytes || 2097152;
  if (!Buffer.isBuffer(buf) || buf.length > max || !imageKind(buf)) throw new Error('图片转不过来，请换一张 jpg 或 png');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const src = `${dest}.${stamp}.src`;
  const out = `${dest}.${stamp}.out`;
  fs.writeFileSync(src, buf);
  try {
    execFileSync('/usr/bin/sips', ['-Z', '512', '-s', 'format', format, src, '--out', out], { stdio: 'ignore', timeout: 20000 });
  } catch {
    throw new Error('图片转不过来，请换一张 jpg 或 png');
  } finally {
    fs.rmSync(src, { force: true });
  }
  if (!fs.existsSync(out)) throw new Error('图片转不过来，请换一张 jpg 或 png');
  return out;
}

function commit(next) {
  config.manual = next.manual;
  config.auto = next.auto;
  config.keepAlive = next.keepAlive;
  config.keepAliveMinutes = next.keepAliveMinutes;
  config.sampleHours = next.sampleHours;
  if (next.site) config.site = next.site; else delete config.site;
  if (next.feishuWebhook) config.feishuWebhook = next.feishuWebhook; else delete config.feishuWebhook;
  if (!config.web) config.web = next.web;
  else {
    config.web.owner = next.web.owner;
    if (next.web.avatar) config.web.avatar = next.web.avatar;
  }
}

export function applyPrefs(body) {
  if (!body || typeof body !== 'object') throw new Error('请求格式不对');
  if (typeof body.owner !== 'string') throw new Error('署名格式不对');
  const owner = body.owner.trim();
  if (owner.length > schema.limits.owner) throw new Error('署名太长');
  const manual = idList(body.manual, '平台');
  const auto = platformIds().filter((id) => !manual.includes(id));
  const keepAlive = idList(body.keepAlive, '保活');
  const keepAliveMinutes = inRange(+body.keepAliveMinutes, 'keepAliveMinutes', '保活间隔');
  const sampleHours = inRange(+body.sampleHours, 'sampleHours', '采样间隔');
  const clearHook = !!body.feishuClear;
  const hook = typeof body.feishuWebhook === 'string' ? body.feishuWebhook.trim() : '';
  if (clearHook && hook) throw new Error('不能同时清除和填写新的飞书地址');
  if (hook) {
    let u;
    try { u = new URL(hook); } catch { throw new Error('飞书 webhook 不是有效地址'); }
    if (u.protocol !== 'https:' || hook.length > 500) throw new Error('飞书 webhook 要用 https');
  }
  const site = cleanSite(body.site);
  const avatarBuf = decodeImage(body.avatar);
  const logoBuf = site ? decodeImage(body.siteLogo) : null;
  if (logoBuf && !site) throw new Error('先填写站点地址，再上传图标');

  const next = JSON.parse(JSON.stringify(config));
  next.web = next.web || {};
  next.web.owner = owner;
  next.manual = manual;
  next.auto = auto;
  next.keepAlive = keepAlive;
  next.keepAliveMinutes = keepAliveMinutes;
  next.sampleHours = sampleHours;
  if (site) next.site = site; else delete next.site;
  if (hook) next.feishuWebhook = hook; else if (clearHook) delete next.feishuWebhook;
  if (avatarBuf) next.web.avatar = 'data/avatar.jpg';
  if (logoBuf && next.site) next.site.logo = 'data/site-logo.png';

  const temps = [];
  try {
    if (avatarBuf) temps.push([convertImage(avatarBuf, path.join(DATA, 'avatar.jpg'), 'jpeg'), path.join(DATA, 'avatar.jpg')]);
    if (logoBuf) temps.push([convertImage(logoBuf, path.join(DATA, 'site-logo.png'), 'png'), path.join(DATA, 'site-logo.png')]);
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, configPath);
    for (const [from, dest] of temps) fs.renameSync(from, dest);
    commit(next);
  } catch (e) {
    for (const [from] of temps) fs.rmSync(from, { force: true });
    fs.rmSync(configPath + '.tmp', { force: true });
    throw e;
  }
}
