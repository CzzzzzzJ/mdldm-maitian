import { withTab, evaluate, click, sleep } from './driver.mjs';

const NEXT = '[aria-label="下一页"],[title="下一页"],[aria-label="Next Page"],[title="Next Page"],[class*="page-next"]';
const readPage = `(() => {
  const cards = [...document.querySelectorAll('[class*=video-card-info]')], text = document.body.innerText || '';
  if (!cards.length) {
    if (/扫码登录|登录后查看|请先登录/.test(text)) return {error:'请先登录抖音'};
    if (/暂无作品|暂无视频|还没有作品/.test(text)) return {videos:[], signature:'empty', finished:true};
    return null;
  }
  const videos = [], ids = [];
  for (const card of cards) {
    const key = Object.keys(card).find(k => k.startsWith('__reactFiber'));
    let fiber = card[key], video;
    for (let i=0; i<25 && fiber; i++, fiber=fiber.return) {
      if (!fiber.memoizedProps) continue;
      video = Object.values(fiber.memoizedProps).find(v => v && typeof v==='object' && v.aweme_id && v.desc!==undefined);
      if (video) break;
    }
    if (!video || !/^\\d+$/.test(String(video.aweme_id))) return {error:'抖音作品数据格式已变化'};
    const id = String(video.aweme_id), published = Number(video.publish_time || video.create_time);
    ids.push(id);
    if (video.status?.in_reviewing || published * 1000 > Date.now()) continue;
    const stat = video.statistics;
    if (!stat || typeof stat!=='object') return {error:'抖音作品统计数据未读到'};
    const metric = key => stat[key] == null ? null : typeof stat[key]==='number' || typeof stat[key]==='string' && /^\\d+$/.test(stat[key]) ? Number(stat[key]) : NaN;
    const m = {views:metric('play_count'),likes:metric('digg_count'),comments:metric('comment_count'),favorites:metric('collect_count'),shares:metric('share_count')};
    if (Object.values(m).every(v => v==null) || Object.values(m).some(v => v!=null && (!Number.isSafeInteger(v) || v<0))) return {error:'抖音作品统计数据格式已变化'};
    videos.push({id,title:String(video.item_title || video.desc || id),url:'https://www.douyin.com/video/'+id,publishedAt:Number.isFinite(published)&&published>0?new Date(published*1000).toISOString():null,...m,extra:{}});
  }
  const next = document.querySelector(${JSON.stringify(NEXT)});
  const disabled = !!next && (next.disabled || next.getAttribute('aria-disabled')==='true' || /disabled/.test(String(next.className)+' '+String(next.parentElement?.className || '')));
  const total = (text.match(/共\\s*(\\d+)\\s*(?:条|个)/) || [])[1];
  const uniqueIds = [...new Set(ids)];
  if (!next && !(total!=null && Number(total)<=uniqueIds.length)) {
    const controls = [...document.querySelectorAll('[class*="pagination"],[class*="page-item"]')].map(e => String(e.className)).join(',').slice(0,120);
    return {error:'抖音分页控件未识别（作品卡片 '+cards.length+' 张；控件 '+(controls || '无')+'）'};
  }
  return {videos,signature:uniqueIds.join(','),finished:disabled || !next};
})()`;

export async function collectDouyinVideos() {
  return withTab('https://creator.douyin.com/creator-micro/content/manage', async tab => {
    const videos = new Map(), seen = new Set();
    let previous = '';
    // shortcut: cap at 500 pages, raise this only when a verified account needs more.
    for (let page = 0; page < 500; page++) {
      let data;
      for (let attempt = 0; attempt < 30; attempt++) {
        data = await evaluate(tab, readPage);
        if (data?.error) throw new Error(data.error);
        if (data && data.signature !== previous) break;
        await sleep(1000);
      }
      if (!data || data.signature === previous) throw new Error(previous ? '抖音翻页后作品列表未变化' : '抖音作品列表未就绪');
      if (seen.has(data.signature)) throw new Error('抖音分页重复，未保存不完整采集');
      seen.add(data.signature);
      for (const video of data.videos) videos.set(video.id, video);
      if (data.finished) return [...videos.values()];
      previous = data.signature;
      await click(tab, `document.querySelector(${JSON.stringify(NEXT)})`);
      await sleep(1000);
    }
    throw new Error('抖音作品超过 500 页，未保存不完整采集');
  }, { wait: 6000 });
}
