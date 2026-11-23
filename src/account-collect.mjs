import fs from 'node:fs';
import { CFG } from './feishu.mjs';
import { db } from './db.mjs';
import { accountTargets } from './account-targets.mjs';
import { syncAccountTraffic } from './account-traffic.mjs';
import { collectBilibiliVideos } from './account-bilibili.mjs';
import { collectDouyinVideos } from './account-douyin.mjs';
import { collectXhsVideos } from './account-xhs.mjs';
import * as drv from './driver.mjs';

const collectors = { bilibili: collectBilibiliVideos, douyin: collectDouyinVideos, xhs: collectXhsVideos };
export const currentAccountTargets = () => accountTargets(JSON.parse(fs.readFileSync(CFG, 'utf8')));

async function bilibiliUid() {
  const uid = await drv.withTab('https://api.bilibili.com/x/web-interface/nav', tab =>
    drv.evaluate(tab, `(()=>{try{const x=JSON.parse((document.querySelector('pre')||document.body).textContent);
      const mid=x.data?.mid; return x.code===0&&x.data?.isLogin&&(typeof mid==='string'||Number.isSafeInteger(mid)) ? String(mid) : ''}catch{return ''}})()`), { wait: 2500 });
  if (!/^[1-9]\d{0,19}$/.test(uid ?? '')) throw new Error('B站没有登录，请先打开该账号登录');
  return uid;
}

export async function collectTraffic(skip = []) {
  const targets = currentAccountTargets().filter(t => !skip.includes(t.id) && !skip.includes(t.platform));
  if (!targets.length) return [];
  const results = await syncAccountTraffic({ db, targets, currentTargets: currentAccountTargets,
    read: target => drv.withTrafficBrowser(target, async () => {
      if (target.platform !== 'bilibili') return collectors[target.platform]();
      const uid = await bilibiliUid();
      if (target.uid && target.uid !== uid) throw new Error('B站登录账号 UID 与配置不一致');
      const existing = db.prepare('SELECT uid FROM account_traffic_identity WHERE platform=?').get(target.id);
      if (existing?.uid && existing.uid !== uid) throw new Error('B站登录账号与历史数据不一致，请切回原账号或新增账号');
      const rows = await collectors.bilibili();
      if (await bilibiliUid() !== uid) throw new Error('B站登录账号在采集中变更，请重试');
      return { rows, uid };
    }) });
  return results.map(r => ({ ...r, name: targets.find(t => t.id === r.id).name }));
}
