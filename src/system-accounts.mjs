// 系统页的登录与体检使用账号键；发布助手的 preflight 仍接收平台名。
import { parseArgs } from 'node:util';
import { getTargets } from './targets.mjs';
import { db, NAMES } from './db.mjs';
import * as drv from './driver.mjs';

export function systemActionTargets(cfg, platforms, args) {
  const { values } = parseArgs({ args, options: {
    target: { type:'string', multiple:true }, only: { type:'string', multiple:true },
    quiet: { type:'boolean' }, notify: { type:'boolean' },
  } });
  const targets = platforms.flatMap(id => id === 'bilibili'
    ? getTargets(cfg).filter(t => t.platform === id) : [{ id, name:NAMES[id] || id }]);
  const selection = values.target || values.only;
  if (selection && (selection.length !== 1 || !selection[0] || (values.target && values.only))) {
    throw new Error('请选择一个账号，或用 --only 指定平台列表');
  }
  const selected = values.target ? selection : values.only?.[0].split(',');
  const rows = selected ? targets.filter(t => selected.includes(t.id)) : targets;
  if (values.target && !rows.length) throw new Error('平台或账号不存在或已停用');
  const supported = t => drv.mode !== 'plugin' || !t.accountId || t.accountId === 'default';
  if (selected && rows.some(t => !supported(t))) throw new Error('B站副号需要 direct 模式');
  return rows.filter(supported);
}

export async function checkSystemLogins(targets) {
  const result = {}, shared = [];
  for (const target of targets) {
    const binding = target.accountId && db.prepare('SELECT uid FROM account_traffic_identity WHERE platform=?').get(target.id)?.uid;
    // 未绑定的传统主号仍用原来的平台预检，不要求先配置 UID 或采流量。
    if (!target.accountId || (target.accountId === 'default' && !target.uid && !binding)) {
      shared.push(target.id);
      continue;
    }
    try {
      if (!target.uid && !binding) throw new Error('请在「管理B站账号」填写 UID，或先采集该账号的作品');
      result[target.id] = await drv.withTrafficBrowser(target, async () => {
        const { bilibiliUid } = await import('./account-collect.mjs');
        const uid = await bilibiliUid();
        if ((target.uid && uid !== target.uid) || (binding && uid !== binding)) throw new Error('登录 UID 与账号绑定不一致，请切回该账号');
        const states = await drv.checkLogin(['bilibili']);
        return states.bilibili;
      });
    } catch (error) {
      result[target.id] = { ok:false, reason:error.message };
    }
  }
  if (shared.length) {
    await drv.ensure();
    Object.assign(result, await drv.checkLogin(shared));
  }
  return result;
}
