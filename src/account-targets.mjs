// Account traffic uses the existing browser by default; optional Bilibili
// accounts share the config editor's raw schema without depending on that UI.
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const names = { bilibili: 'B站', douyin: '抖音', xhs: '小红书' };
const absolute = p => path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));
export function accountTargets(cfg) {
  const list = cfg.bilibiliAccounts ?? [];
  const defaultPort = cfg.chromePort || 9333;
  const defaultProfile = absolute(cfg.chromeProfile || '~/publish-hub/chrome-profile');
  const disabled = id => (cfg.disabled || []).includes(id) || (cfg.disabledPlatforms || []).includes(id) || (Array.isArray(cfg.enabledPlatforms) && !cfg.enabledPlatforms.includes(id));
  const targets = [], ids = new Set(), ports = new Set([defaultPort]), profiles = new Set([defaultProfile]), uids = new Set();
  for (const [platform, name] of Object.entries(names)) {
    if (disabled(platform)) continue;
    const base = { id: platform, platform, name, chromePort: defaultPort, chromeProfile: defaultProfile };
    if (platform !== 'bilibili') { targets.push(base); continue; }
    if (!Array.isArray(list)) throw new Error('B站账号列表无效');
    const records = list.some(x => x?.id === 'default') ? list : [{ id:'default' }, ...list];
    for (const a of records) {
      if (!a || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(a.id ?? '') || ids.has(a.id)) throw new Error('B站账号标识无效或重复');
      ids.add(a.id);
      if (a.enabled === false || a.removed) continue;
      const isDefault = a.id === 'default';
      const uid = a.uid ?? '';
      if (typeof uid !== 'string' || (uid && (!/^[1-9]\d{0,19}$/.test(uid) || uids.has(uid)))) throw new Error('B站账号 UID 无效或重复');
      if (uid) uids.add(uid);
      const chromePort = isDefault ? defaultPort : (a.chromePort ?? 20000 + createHash('sha256').update(a.id).digest().readUInt16BE() % 30000);
      const chromeProfile = isDefault ? defaultProfile : absolute(a.chromeProfile || `${defaultProfile}-accounts/${a.id}`);
      if (!Number.isInteger(chromePort) || chromePort < 1024 || chromePort > 65535 || (!isDefault && (ports.has(chromePort) || profiles.has(chromeProfile)))) throw new Error('B站账号端口或登录目录无效或重复');
      ports.add(chromePort); profiles.add(chromeProfile);
      const tag = typeof a.name === 'string' ? a.name.trim() : '';
      targets.push({ ...base, id: isDefault ? platform : `${platform}@${a.id}`, accountId:a.id, uid, chromePort, chromeProfile,
        name: tag && tag !== '默认账号' ? `${name} · ${tag}` : isDefault ? name : `${name} · ${a.id}` });
    }
  }
  return targets;
}
