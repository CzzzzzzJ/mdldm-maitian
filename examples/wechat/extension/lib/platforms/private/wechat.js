// 公众号（wechat）：麦田的私有平台适配器。放在扩展点 extra.js 里注册，不改核心 publish.js。
// 思路来自 xihe-lab/wechat-mp-mcp-server 的 webhub 层（Apache-2.0）：不点编辑器，直接调后台内部接口
//   1) /cgi-bin/filetransfer 上传封面图 → mmbiz cdn_url
//   2) /cgi-bin/operate_appmsg?sub=create 建图文草稿
// 群发必须人点（每日 1 次额度），所以这里只建草稿，永远不点群发。
import { evaluate, sleep } from '../../cdp.js';

// direct 模式（麦田中控直连专用 Chrome）下适配器跑在 Node 里，可以直接读本地封面文件；
// 商店插件环境里没有 fs，此时要求 publish.json 里给好 coverB64 或 cdnUrl。
let readB64 = null;
try {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { readFileSync } = await import('node:fs');
    readB64 = (p) => readFileSync(p).toString('base64');
  }
} catch { /* 浏览器环境，没有 fs */ }

const MP = 'https://mp.weixin.qq.com/';

// 在后台页里：取 token / userName / ticket
const META = `(()=>{
  const html = document.documentElement.outerHTML;
  const token = (location.href.match(/token=(\\d+)/)||[])[1] || (html.match(/token\\s*[:=]\\s*["']?(\\d{5,})/)||[])[1] || '';
  const userName = (html.match(/user_name\\s*[:=]\\s*["']([^"']+)["']/)||[])[1] || '';
  const ticket = (html.match(/ticket\\s*[:=]\\s*["']([^"']{8,})["']/)||[])[1] || '';
  return { token, userName, ticket, href: location.href };
})()`;

// 把 base64 图按 2.35:1 居中裁切、压成 JPEG，再 POST 到 filetransfer
function uploadExpr(b64, mime) {
  return `(async()=>{
    const meta = ${META};
    if (!meta.token) return { error: '不在公众号后台（没有 token），请先登录' };
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('封面解码失败')); img.src = 'data:${mime};base64,${b64}'; });
    const RATIO = 900 / 383;
    let sw = img.width, sh = Math.round(img.width / RATIO);
    if (sh > img.height) { sh = img.height; sw = Math.round(img.height * RATIO); }
    const sx = Math.round((img.width - sw) / 2), sy = Math.round((img.height - sh) / 2);
    const c = document.createElement('canvas'); c.width = 900; c.height = 383;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, 900, 383);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const fd = new FormData();
    fd.append('type', 'image'); fd.append('name', 'cover-2x35.jpg'); fd.append('size', String(blob.size));
    fd.append('file', blob, 'cover-2x35.jpg');
    const url = '/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=' + meta.userName + '&ticket=' + meta.ticket + '&token=' + meta.token + '&lang=zh_CN';
    const txt = await fetch(url, { method: 'POST', credentials: 'include', body: fd }).then(r => r.text());
    let j; try { j = JSON.parse(txt); } catch { return { error: '上传返回非 JSON：' + txt.slice(0, 120) }; }
    if (!j.base_resp || j.base_resp.ret !== 0) return { error: '上传失败：' + ((j.base_resp && (j.base_resp.err_msg || j.base_resp.ret)) || '未知') };
    return { cdnUrl: j.cdn_url, token: meta.token, bytes: blob.size };
  })()`;
}

// operate_appmsg 建草稿（字段名与后台编辑器保存时一致）
function draftExpr(p, cdnUrl, token, appMsgId) {
  return `(async()=>{
    const f = new URLSearchParams();
    const set = (k, v) => f.set(k, String(v == null ? '' : v));
    set('token', ${JSON.stringify(token)}); set('lang', 'zh_CN'); set('f', 'json'); set('ajax', '1');
    set('random', String(Math.random()));
    set('AppMsgId', ${JSON.stringify(appMsgId || '')}); set('count', '1'); set('data_seq', '0');
    set('operate_from', 'Chrome'); set('isnew', ${appMsgId ? "'1'" : "'0'"});
    set('title0', ${JSON.stringify(p.title || '')});
    set('author0', ${JSON.stringify(p.author || '')});
    set('writerid0', '0'); set('fileid0', '');
    set('digest0', ${JSON.stringify(p.digest || '')});
    set('auto_gen_digest0', ${p.digest ? "'0'" : "'1'"});
    set('content0', ${JSON.stringify(p.contentHtml || p.content || '')});
    set('sourceurl0', ${JSON.stringify(p.sourceUrl || '')});
    set('need_open_comment0', '1'); set('only_fans_can_comment0', '0');
    set('cdn_url0', ${JSON.stringify(cdnUrl || '')});
    set('cdn_235_1_url0', ${JSON.stringify(cdnUrl || '')});
    set('cdn_1_1_url0', ${JSON.stringify(cdnUrl || '')});
    set('cdn_url_back0', ${JSON.stringify(cdnUrl || '')});
    for (const k of ['crop_list0','music_id0','video_id0','voteid0','voteismlt0','supervoteid0','cardid0','cardquantity0','cardlimit0','vid_type0','shortvideofileid0','releasefirst0','platform0','reprint_permit_type0','allow_reprint0','allow_reprint_modify0','original_article_type0','ori_white_list0','free_content0','ad_id0','guide_words0','share_copyright_url0','source_article_type0','reprint_recommend_title0','reprint_recommend_content0','share_video_id0','share_voice_id0','insert_ad_mode0']) set(k, '');
    set('show_cover_pic0', '1');
    set('copyright_type0', '0'); set('fee0', '0');
    set('is_share_copyright0', '0'); set('share_page_type0', '0');
    set('share_imageinfo0', '{"list":[]}'); set('dot0', '{}'); set('categories_list0', '[]');
    const sub = ${appMsgId ? "'update'" : "'create'"};
    const txt = await fetch('/cgi-bin/operate_appmsg?t=ajax-response&sub=' + sub + '&type=77&token=' + ${JSON.stringify(token)} + '&lang=zh_CN',
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() }).then(r => r.text());
    let j; try { j = JSON.parse(txt); } catch { return { error: '建草稿返回非 JSON：' + txt.slice(0, 160) }; }
    if (!j.base_resp || j.base_resp.ret !== 0) return { error: '建草稿失败：' + ((j.base_resp && (j.base_resp.err_msg || j.base_resp.ret)) || '未知'), raw: txt.slice(0, 200) };
    return { appMsgId: String(j.appMsgId || j.AppMsgId || '') };
  })()`;
}

export default {
  id: 'wechat',
  name: '公众号',
  url: MP,
  // 后台首页（有 token 才算真的登录）
  ready: `/cgi-bin/.test(location.href) || !!document.querySelector('#js_main')`,

  async fill(ctx) {
    const T = ctx.tabId, p = ctx.p;
    const meta = await evaluate(T, META);
    if (!meta || !meta.token) throw new Error('公众号后台没登录或没进到 /cgi-bin/ 首页，请先扫码登录');

    // 1) 封面：优先 cdnUrl（publish.json 里已经准备好），否则本地读图上传
    let cdnUrl = p.cdnUrl || '';
    const coverFile = ctx.cover('16x9') || ctx.cover('4x3') || p.coverPath || null;
    if (!cdnUrl && coverFile && readB64) {
      const mime = /\.png$/i.test(coverFile) ? 'image/png' : 'image/jpeg';
      const r = await evaluate(T, uploadExpr(readB64(coverFile), mime));
      if (r && r.error) throw new Error('封面没传上去：' + r.error);
      cdnUrl = r.cdnUrl;
      ctx.log(`封面已上公众号图床（${Math.round((r.bytes || 0) / 1024)}KB，900×383）`);
    }
    if (!cdnUrl) ctx.note('没有封面图，草稿将是纯文字（公众号会要求补封面才能群发）');

    // 2) 建草稿
    const d = await evaluate(T, draftExpr(p, cdnUrl, meta.token, p.draftId));
    if (d && d.error) throw new Error(d.error);
    ctx.draftId = d.appMsgId;
    ctx.log(`草稿已建好（appMsgId ${d.appMsgId}）`);
    ctx.note('群发要你本人点：公众号后台 → 草稿箱 → 这篇 → 群发。每天只有 1 次群发额度');
    await sleep(500);
  },

  // 建草稿是同步接口，没有"上传中"这一阶段
  uploadDone: null,

  links: {
    url: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10',
    ready: `!!document.querySelector('.weui-desktop-panel, #js_main')`,
    async collect(T, p) {
      const title = String(p.title || '').trim();
      const r = await evaluate(T, `(async()=>{
        const token = (location.href.match(/token=(\\d+)/)||[])[1] || '';
        const txt = await fetch('/cgi-bin/appmsgpublish?sub=list&begin=0&count=10' + (token ? '&token=' + token : '') + '&lang=zh_CN&f=json&ajax=1', { credentials: 'include' }).then(r => r.text());
        let j; try { j = JSON.parse(txt); } catch { return null; }
        let page = j.publish_page || {}; if (typeof page === 'string') page = JSON.parse(page);
        for (const x of (page.publish_list || [])) {
          let info = x.publish_info; if (typeof info === 'string') { try { info = JSON.parse(info); } catch { continue; } }
          for (const a of (info.appmsg_info || [])) if (a.title === ${JSON.stringify(title)}) return { url: a.content_url, read: a.read_num, like: a.like_num, comment: a.comment_num, msgid: info.msgid };
        }
        return null;
      })()`);
      if (!r) return null;
      return { status: '已发布', url: r.url || '', note: `阅读 ${r.read ?? '-'}｜赞 ${r.like ?? '-'}｜评论 ${r.comment ?? '-'}` };
    },
  },
};
