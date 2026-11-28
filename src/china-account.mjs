import { evaluate, withTab, sleep } from './driver.mjs';
import { chinaAccountRowsJs, chinaMetricPages, chinaFansJs, kuaishouListJs, kuaishouFanPeriodJs } from './china-metrics.mjs';
import { crawlKuaishouList } from './kuaishou-crawl.mjs';

export function scanKuaishouList(workId) {
  const {url,row} = chinaMetricPages.kuaishou;
  return withTab(url, tab => crawlKuaishouList({
    snapshot: () => evaluate(tab, kuaishouListJs()),
    advance: () => evaluate(tab, `(()=> {
      const last=[...document.querySelectorAll(${JSON.stringify(row)})].at(-1);
      last?.scrollIntoView({block:'end'});
      for(let n=last?.parentElement;n;n=n.parentElement)
        if(n.scrollHeight>n.clientHeight&&/auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop=n.scrollHeight;
    })()`),
    wait: () => sleep(1000),
    attempts: workId ? 25 : 90,
  }, {workId}), {wait:1500});
}

// A站分页必须读到最后一页；快手滚动列表必须达到页面声明的作品总数。
export async function scanChinaAccount(platform) {
  if (platform === 'kuaishou') return (await scanKuaishouList()).rows;
  const {url, row} = chinaMetricPages[platform];
  return withTab(url, async tab => {
    const out = new Map();
    let previous = '', deadline = Date.now() + 100000;
    let moved = false;
    while (Date.now() < deadline) {
      const state = await evaluate(tab, `(()=>{
        const all=[...document.querySelectorAll(${JSON.stringify(row)})];
        const next=document.querySelector('.pager__btn__next');
        const signature=all.map(r=>r.querySelector('.aid')?.innerText||r.querySelector('.c-content-title')?.innerText).join('|');
        return {n:all.length,signature,next:!!next&&!next.classList.contains('pager__btn__disabled'),pager:!!next,
          empty:/暂无(视频稿件|稿件|数据)|还没有(投过稿|作品)/.test(document.querySelector('.c-content-list')?.innerText||''),
          login:/login|passport/.test(location.hostname+location.pathname)};
      })()`);
      if (state.login) throw new Error('请先登录创作者后台');
      if (!state.n && state.empty) return [];
      if (state.n && (!moved || state.signature !== previous)) {
        const batch = await evaluate(tab, chinaAccountRowsJs(platform));
        for (const item of batch) out.set(item.id,item);
        if (state.pager && !state.next) return [...out.values()];
        if (state.next) {
          await evaluate(tab, `(()=>{const b=document.querySelector('.pager__btn__next');if(b&&!b.classList.contains('pager__btn__disabled'))b.click()})()`);
          previous = state.signature; moved = true;
        }
      }
      await sleep(1000);
    }
    throw new Error('未读到完整作品列表，保留上次采集结果');
  }, {wait:3500});
}

export async function readChinaFans(platform) {
  const url = platform === 'acfun' ? 'https://member.acfun.cn/video-data-center' : 'https://cp.kuaishou.com/statistics/user/fans';
  const read = (page, js, delay, attempts) => withTab(page, async tab => {
    for (let i=0;i<attempts;i++) {
      const r = await evaluate(tab, `location.origin+location.pathname===${JSON.stringify(page)} ? (${js}) : null`);
      if (r) return r;
      if (i+1<attempts) await sleep(900);
    }
    return null;
  }, {wait:delay});
  const total = await read(url, chinaFansJs(platform), 3500, platform === 'kuaishou' ? 4 : 8);
  if (total || platform !== 'kuaishou') return total;
  const period = await read('https://cp.kuaishou.com/profile', kuaishouFanPeriodJs(), 3500, 5);
  return period ? {total:null, history:[], period} : null;
}
