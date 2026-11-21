import { withTab, evaluate, sleep } from './driver.mjs';

const PAGE_SIZE = 50, MAX_PAGES = 200;

export async function collectBilibiliVideos() {
  try {
    return await withTab('https://member.bilibili.com/platform/upload-manager/article', async tab => {
      const videos = [], seen = new Set();
      let total = null;
      for (let pn = 1; pn <= MAX_PAGES; pn++) {
        const result = await evaluate(tab, `(async()=>{try{
          const r=await fetch('/x/web/archives?status=pubed&pn=${pn}&ps=${PAGE_SIZE}&coop=1',{credentials:'include',signal:AbortSignal.timeout(15000)});
          if(!r.ok)return {error:'HTTP '+r.status};
          return {body:await r.json()};
        }catch(e){return {error:e.message||'请求失败'}}})()`, 20000);
        if (!result || result.error) throw new Error(result?.error || '接口没有响应');
        const x = result.body;
        if (x?.code !== 0) throw new Error(x?.code === -101 ? '账号未登录' : '接口返回错误');
        const rows = x.data?.arc_audits, page = x.data?.page;
        if (!Array.isArray(rows) || !Number.isSafeInteger(page?.count) || page.count < 0 || (page.pn != null && page.pn !== pn)) throw new Error('作品列表格式异常');
        if (total != null && total !== page.count) throw new Error('作品数量在采集中变化，请重试');
        total = page.count;
        if (Math.ceil(total / PAGE_SIZE) > MAX_PAGES) throw new Error(`作品超过 ${MAX_PAGES * PAGE_SIZE} 条上限，无法完整采集`);
        if (rows.length !== Math.min(PAGE_SIZE, total - (pn - 1) * PAGE_SIZE)) throw new Error('作品列表不完整，请重试');
        for (const row of rows) {
          const a = row?.Archive, s = row?.stat;
          if (!a || !/^BV[0-9A-Za-z]{10}$/.test(a.bvid) || typeof a.title !== 'string' || !a.title.trim() || !s || !Number.isSafeInteger(s.view) || s.view < 0) throw new Error('作品或播放数据格式异常');
          if (seen.has(a.bvid)) throw new Error('作品分页重复，无法完整采集，请重试');
          seen.add(a.bvid);
          if (a.state != null && a.state < 0) continue;
          const count = key => {
            if (s[key] == null) return null;
            if (!Number.isSafeInteger(s[key]) || s[key] < 0) throw new Error('互动数据格式异常');
            return s[key];
          };
          const publishedAt = Number.isSafeInteger(a.pubdate) && a.pubdate > 0 ? new Date(a.pubdate * 1000).toISOString() : null;
          videos.push({ id: a.bvid, title: a.title, url: `https://www.bilibili.com/video/${a.bvid}/`, publishedAt,
            views: s.view, likes: count('like'), comments: count('reply'), favorites: count('favorite'), shares: count('share'), extra: { 投币: count('coin'), 弹幕: count('danmaku') } });
        }
        if (pn * PAGE_SIZE >= total) return videos;
        await sleep(1000);
      }
      throw new Error('作品页数超过上限，无法完整采集');
    });
  } catch (e) {
    throw new Error('B站流量采集失败：' + e.message);
  }
}
