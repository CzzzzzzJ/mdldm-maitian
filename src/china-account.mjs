import { evaluate, withTab, sleep } from './driver.mjs';
import { chinaAccountRowsJs, chinaMetricPages, chinaFansJs } from './china-metrics.mjs';

// A站分页必须读到最后一页；快手滚动列表必须达到页面声明的作品总数。
export async function scanChinaAccount(platform) {
  const {url, row} = chinaMetricPages[platform];
  return withTab(url, async tab => {
    const out = new Map();
    let previous = '', deadline = Date.now() + 100000;
    let moved = false;
    while (Date.now() < deadline) {
      const state = await evaluate(tab, `(()=>{
        const all=[...document.querySelectorAll(${JSON.stringify(row)})];
        const next=document.querySelector('.pager__btn__next');
        const list=document.querySelector('.works-manage');
        const total=list?.querySelector('.works-manage__status__count')?.innerText.match(/共\\s*([\\d,]+)\\s*个作品/);
        const signature=${JSON.stringify(platform)}==='acfun' ? all.map(r=>r.querySelector('.aid')?.innerText||r.querySelector('.c-content-title')?.innerText).join('|') : String(all.length);
        return {n:all.length,signature,next:!!next&&!next.classList.contains('pager__btn__disabled'),pager:!!next,
          total:total?Number(total[1].replace(/,/g,'')):null,empty:/暂无(视频稿件|稿件|数据)|还没有(投过稿|作品)/.test(document.querySelector('.c-content-list')?.innerText||''),
          login:/login|passport/.test(location.hostname+location.pathname)};
      })()`);
      if (state.login) throw new Error('请先登录创作者后台');
      if (!state.n && (state.total === 0 || state.empty)) return [];
      if (state.n && (!moved || state.signature !== previous)) {
        const batch = await evaluate(tab, chinaAccountRowsJs(platform));
        for (const item of batch) out.set(item.id,item);
        if (platform === 'acfun' && state.pager && !state.next || platform === 'kuaishou' && state.total !== null && state.n >= state.total)
          return [...out.values()];
        if (platform === 'acfun' && state.next) {
          await evaluate(tab, `(()=>{const b=document.querySelector('.pager__btn__next');if(b&&!b.classList.contains('pager__btn__disabled'))b.click()})()`);
          previous = state.signature; moved = true;
        }
      }
      if (platform === 'kuaishou' && state.n) await evaluate(tab, `(()=>{
        const last=[...document.querySelectorAll(${JSON.stringify(row)})].at(-1);
        last?.scrollIntoView({block:'end'});
        for(let n=last?.parentElement;n;n=n.parentElement) if(n.scrollHeight>n.clientHeight&&/auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop=n.scrollHeight;
      })()`);
      await sleep(1000);
    }
    throw new Error('未读到完整作品列表，保留上次采集结果');
  }, {wait:3500});
}

export async function readChinaFans(platform) {
  const url = platform === 'acfun' ? 'https://member.acfun.cn/video-data-center' : 'https://cp.kuaishou.com/statistics/user/fans';
  return withTab(url, async tab => {
    for (let i=0;i<8;i++) {
      const r = await evaluate(tab, chinaFansJs(platform));
      if (r) return r;
      if (i<7) await sleep(900);
    }
    return null;
  }, {wait:4000});
}
