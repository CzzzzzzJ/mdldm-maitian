// 本机私有扩展：把公众号（wechat）接进麦田采集层。核心 src/metrics.mjs 不改。
// 原理：collectors 是普通对象，import 拿到的是同一引用，这里运行时追加一个采集器。
// 数据源：发表记录接口 /cgi-bin/appmsgpublish（在登录会话中动态读取 CSRF token，不保存凭证）
//         read_num 阅读 / like_num 点赞 / old_like_num 在看 / comment_num 评论
import { collectors, num } from './metrics.mjs';
import { evaluate, withTab, sleep } from './driver.mjs';

const MP_HOME = 'https://mp.weixin.qq.com/';
const J = JSON.stringify;

// 在公众号后台里执行：拿 token（拿不到就直接用 cookie 打接口）→ 拉最近 10 篇发表记录 → 拍平成文章数组
const PULL = `(async()=>{
  let token = (location.href.match(/token=(\\d+)/)||[])[1] || '';
  const txt = await fetch('/cgi-bin/appmsgpublish?sub=list&begin=0&count=10'+(token?'&token='+token:'')+'&lang=zh_CN&f=json&ajax=1',{credentials:'include'}).then(r=>r.text());
  let j; try { j = JSON.parse(txt); } catch { return { err: 'not-json', head: txt.slice(0,120) }; }
  if (!j.base_resp || j.base_resp.ret !== 0) return { err: 'bad-ret', ret: j.base_resp && j.base_resp.ret, msg: j.base_resp && j.base_resp.err_msg };
  let page = j.publish_page; if (typeof page === 'string') page = JSON.parse(page);
  const arts = [];
  for (const p of (page.publish_list || [])) {
    let info = p.publish_info; if (typeof info === 'string') { try { info = JSON.parse(info); } catch { continue; } }
    const sent = info.sent_info && info.sent_info.time;
    for (const a of (info.appmsg_info || [])) arts.push({
      title: a.title, url: a.content_url, appmsgid: a.appmsgid, msgid: info.msgid, itemidx: a.itemidx,
      read: a.read_num, like: a.like_num, zaikan: a.old_like_num, comment: a.comment_num, sentAt: sent,
      deleted: !!a.is_deleted,
    });
  }
  return { arts };
})()`;

// 后台首页还没进 cgi-bin（比如 cookie 过期停在登录页）时，先点一下让它跳转
async function pull(tabId) {
  for (let i = 0; i < 12; i++) {
    const r = await evaluate(tabId, PULL).catch((e) => ({ err: e.message }));
    if (r && r.arts && r.arts.length) return r;
    if (r && r.err === 'not-json') {   // 多半是登录页 HTML
      await evaluate(tabId, `(location.href='https://mp.weixin.qq.com/',1)`).catch(() => {});
    }
    await sleep(2500);
  }
  return null;
}

collectors.wechat = async ({ url, p }) => {
  const title = String((p && p.title) || '').trim();
  const slug = ((url || '').match(/\/s\/([\w-]+)/) || [])[1] || '';
  if (!title && !slug) return null;
  const r = await withTab(MP_HOME, (t) => pull(t), { wait: 6000 });
  if (!r || !r.arts) return null;
  const matches = r.arts.filter(a => !a.deleted && (slug ? a.url && a.url.includes('/s/' + slug) : a.title === title));
  const hit = matches.length === 1 ? matches[0] : null;
  if (!hit) return null;
  return {
    views: num(hit.read), likes: num(hit.like), comments: num(hit.comment), shares: null,
    extra: { 在看: num(hit.zaikan), 阅读原文: null },
    url: hit.url || url || '',
  };
};

export const WECHAT_OK = true;
