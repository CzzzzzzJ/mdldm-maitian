import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export const PLATFORM_NAMES = { bilibili: 'B站', douyin: '抖音', xhs: '小红书', channels: '视频号', youtube: 'YouTube', x: 'X', instagram: 'Instagram', zsz: '知识站' };
export const basePlatform = id => String(id).split('@')[0];
const homePath = p => path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));
// Keep the existing platform switch authoritative. Targets are for account-level
// consumers, not a new source of truth for the publishing pipeline.
export function configuredPlatforms(cfg) {
  const disabled = cfg.disabled ?? [];
  if (!Array.isArray(disabled)) throw new Error('停用平台列表无效');
  return Object.keys(PLATFORM_NAMES).filter(id => !disabled.includes(id));
}
export function enabledPlatforms(cfg) {
  return configuredPlatforms(cfg).filter(id => id !== 'zsz' || (cfg.site?.base && cfg.site.enabled !== false));
}
export function accountsOf(cfg) {
  const list = cfg.bilibiliAccounts ?? [];
  if (!Array.isArray(list)) throw new Error('B站账号列表无效');
  const accounts = list.some(a => a?.id === 'default') ? list : [{ id: 'default', name: '默认账号' }, ...list];
  const ids = new Set(), uids = new Set(), ports = new Set(), profiles = new Set();
  const defaultProfile = homePath(cfg.chromeProfile || '~/publish-hub/chrome-profile');
  return accounts.toSorted((a, b) => a?.id === 'default' ? -1 : b?.id === 'default' ? 1 : 0).map(a => {
    if (!a || typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(a.id) || ids.has(a.id)) throw new Error('B站账号标识无效或重复');
    ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 40) throw new Error('B站账号名称应为 1–40 个字符');
    if ((a.enabled !== undefined && typeof a.enabled !== 'boolean') || (a.removed !== undefined && typeof a.removed !== 'boolean')) throw new Error('B站账号启用状态无效');
    const uid = a.uid ?? '';
    if (typeof uid !== 'string' || (uid && !/^[1-9]\d{0,19}$/.test(uid)) || (uid && uids.has(uid))) throw new Error('B站账号 UID 无效或重复');
    if (uid) uids.add(uid);
    const chromePort = a.id === 'default' ? (cfg.chromePort || 9333) : (a.chromePort ?? (20000 + createHash('sha256').update(a.id).digest().readUInt16BE() % 30000));
    const chromeProfile = a.id === 'default' ? defaultProfile : homePath(a.chromeProfile || `${defaultProfile}-accounts/${a.id}`);
    if (!Number.isInteger(chromePort) || chromePort < 1024 || chromePort > 65535 || ports.has(chromePort)) throw new Error('B站账号调试端口无效或重复');
    if (profiles.has(chromeProfile)) throw new Error('B站账号不能共用登录目录');
    ports.add(chromePort); profiles.add(chromeProfile);
    return { ...a, name: a.name.trim(), uid, enabled: a.enabled !== false && !a.removed, chromePort, chromeProfile };
  });
}
export function getTargets(cfg) {
  const accounts = accountsOf(cfg), ids = enabledPlatforms(cfg);
  return ids.flatMap(platform => platform === 'bilibili' ? accounts.filter(a => a.enabled).map(a => ({
    id: a.id === 'default' ? 'bilibili' : `bilibili@${a.id}`, platform, accountId: a.id,
    name: a.name === '默认账号' ? 'B站' : `B站 · ${a.name}`, uid: a.uid, chromePort: a.chromePort, chromeProfile: a.chromeProfile,
  })) : [{ id: platform, platform, name: platform === 'zsz' ? (cfg.site?.name || PLATFORM_NAMES[platform]) : PLATFORM_NAMES[platform], chromePort: cfg.chromePort || 9333, chromeProfile: homePath(cfg.chromeProfile || '~/publish-hub/chrome-profile') }]);
}
export function getTarget(cfg, id) {
  const target = getTargets(cfg).find(t => t.id === id);
  if (!target) throw new Error(`平台或账号未启用：${id}`);
  return target;
}
export function matchesTarget(id, selection) { return selection.includes(id) || selection.includes(basePlatform(id)); }
export function settingsView(cfg) {
  const enabled = enabledPlatforms(cfg);
  return { platforms: Object.entries(PLATFORM_NAMES).map(([id, name]) => ({ id, name: id === 'zsz' ? (cfg.site?.name || name) : name, available: id !== 'zsz' || !!cfg.site?.base, enabled: enabled.includes(id) })), enabledPlatforms: enabled,
    bilibiliAccounts: accountsOf(cfg).filter(a => !a.removed).map(({ id, name, uid, enabled }) => ({ id, name, uid, enabled })), driver: process.env.HUB_DRIVER || cfg.driver || 'direct' };
}
