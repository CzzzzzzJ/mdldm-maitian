// 本机私有扩展：公众号粉丝数走「用户分析」页 DOM（useranalysis 接口返回空，DOM 稳）
// 复用 flyers 同款「累计关注 / 新增 / 取消 / 净增」表格，直接解析成 history
import { followerCollectors, today } from './followers.mjs';
import { evaluate, withTab, sleep } from './driver.mjs';
import { num } from './metrics.mjs';

const ROW = /(\d{4}-\d{2}-\d{2})\s*\n?\s*(\d[\d,]*)\s*\n?\s*(\d[\d,]*)\s*\n?\s*(\d[\d,]*)\s*\n?\s*(\d[\d,]*)/g;

followerCollectors.wechat = async () => {
  const r = await withTab('https://mp.weixin.qq.com/', async (t) => {
    let token = '';
    for (let i = 0; i < 12 && !token; i++) {
      await sleep(2500);
      token = await evaluate(t, "(location.href.match(/token=(\\d+)/)||[])[1]||''").catch(() => '');
    }
    if (!token) return null;
    await evaluate(t, `(location.href='https://mp.weixin.qq.com/misc/useranalysis?t=useranalysis/index&token=${token}&lang=zh_CN',1)`);
    let txt = '';
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      txt = await evaluate(t, "document.body.innerText").catch(() => '');
      if (/累计关注/.test(txt) && /\d{4}-\d{2}-\d{2}/.test(txt)) break;
    }
    return { token, txt };
  }, { wait: 8000 });
  if (!r || !r.txt) return null;
  const total = num(((r.txt.match(/累计关注人数\s*\n?\s*([\d,.万]+)/) || [])[1]));
  const tableAt = r.txt.indexOf('详细数据表格');
  const tail = tableAt < 0 ? '' : r.txt.slice(tableAt);
  const rows = [...tail.matchAll(ROW)].map((m) => ({
    day: m[1], gain: num(m[2]), loss: num(m[3]), net: num(m[4]), total: num(m[5]),
  })).filter((x) => x.day && x.total != null);
  if (total == null && !rows.length) return null;
  return { total: total != null ? total : rows[0].total, history: rows.map((x) => ({ day: x.day, total: x.total, gain: x.gain, loss: x.loss })) };
};
