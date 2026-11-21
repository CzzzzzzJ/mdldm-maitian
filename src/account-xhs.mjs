import { evaluate, withTab, sleep } from './driver.mjs';

const nextButton = `([...document.querySelectorAll('button,[role="button"],a')].find(e => {
  const r = e.getBoundingClientRect(), label = e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '';
  return r.width > 0 && r.height > 0 && (/下一页|next page/i.test(label) || /btn-next|pagination-next|next-page/.test(String(e.className)));
}))`;
const readPage = `(()=>{
  const text = document.body.innerText || '', cards = [...document.querySelectorAll('.note-card')];
  if (/\\/login(?:[/?#]|$)/.test(location.href) || (!cards.length && /扫码登录|手机号登录|验证码登录/.test(text))) return {error:'小红书没有登录'};
  const next = ${nextButton}, total = text.match(/共\\s*(\\d+)\\s*(?:条|篇)|全部\\s*(\\d+)/);
  return { cards: cards.map(c => {
    let id = ''; try { id = JSON.parse(c.getAttribute('data-impression')).noteTarget.value.noteId; } catch {}
    const text = c.innerText || '';
    return { id, title: ((c.querySelector('.note-card__title') || {}).innerText || '').trim(),
      unpublished: /审核中|审核未通过|定时发布|笔记未通过|未发布|草稿|已删除/.test(text),
      time: (text.match(/\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/) || [])[0] || '',
      stats: [...c.querySelectorAll('.note-card__stat')].map(e => e.innerText.trim()) };
  }), next: !!next, ended: !!next && (next.disabled || next.getAttribute('aria-disabled') === 'true' || /disabled/.test(String(next.className))),
  endText: /没有更多了|暂无更多|已全部加载|已经到底|已到底/.test(text), empty: /暂无笔记|还没有发布|暂无内容|暂无数据/.test(text), total: total ? Number(total[1] ?? total[2]) : null };
})()`;
const count = value => {
  const m = String(value ?? '').replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*(万|亿|k|m|w)?$/i);
  return m ? Math.round(Number(m[1]) * ({万:1e4,亿:1e8,k:1e3,m:1e6,w:1e4}[m[2]?.toLowerCase()] || 1)) : null;
};

export async function collectXhsVideos() {
  return withTab('https://creator.xiaohongshu.com/new/note-manager', async tab => {
    const rows = new Map(), all = new Set();
    let state = await evaluate(tab, readPage), stagnant = 0;
    for (let i = 0; i < 30 && !state.error && !state.cards?.length && !state.empty; i++) {
      await sleep(1000); state = await evaluate(tab, readPage);
    }
    for (let page = 0; page < 500; page++) {
      if (state.error) throw new Error(state.error);
      if (!Array.isArray(state.cards)) throw new Error('小红书作品列表格式不对');
      const before = all.size;
      for (const c of state.cards) {
        if (!c.id || !/^[\w-]+$/.test(c.id)) throw new Error('小红书作品 ID 没读到');
        all.add(c.id);
        if (c.unpublished) continue;
        if (!c.title || c.stats.length < 5 || count(c.stats[0]) == null) throw new Error(`小红书作品指标没读到：${c.id}`);
        const date = c.time && new Date(c.time.replace(' ', 'T') + ':00+08:00');
        rows.set(c.id, {id:c.id,title:c.title,url:`https://www.xiaohongshu.com/explore/${c.id}`,publishedAt:date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
          views:count(c.stats[0]),comments:count(c.stats[1]),likes:count(c.stats[2]),favorites:count(c.stats[3]),shares:count(c.stats[4]),extra:{}});
      }
      if (state.ended || state.endText || (all.size > 0 && state.total != null && all.size >= state.total) || (!all.size && state.empty)) return [...rows.values()];
      const signature = state.cards.map(c => c.id).join('|');
      if (state.next) {
        await evaluate(tab, `(()=>{const next=${nextButton};if(!next||next.disabled||next.getAttribute('aria-disabled')==='true')return false;next.click();return true})()`);
        let changed = false;
        for (let i = 0; i < 10; i++) {
          await sleep(1000); state = await evaluate(tab, readPage);
          if (state.error || state.cards?.map(c => c.id).join('|') !== signature) {changed = true;break;}
        }
        if (!changed) throw new Error('小红书翻页后作品列表未变化');
      } else {
        stagnant = all.size === before ? stagnant + 1 : 0;
        if (stagnant >= 3) throw new Error(`小红书未确认已加载全部作品（已读 ${all.size} 条，无下一页或结束标记）`);
        await evaluate(tab, `(()=>{let p=document.querySelector('.note-card')?.parentElement;while(p&&!(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight))p=p.parentElement;if(p)p.scrollTop=p.scrollHeight;else window.scrollTo(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight))})()`);
        await sleep(1000); state = await evaluate(tab, readPage);
      }
    }
    throw new Error('小红书作品超过 500 页，本次未保存，请缩小采集范围');
  }, {wait:12000});
}
