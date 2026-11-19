// ⑦ 视频号评论页、私信页只读适配器探针。
// 视频号助手的业务页面在 wujie 微前端里：DOM 在 <wujie-app> 的 shadowRoot，请求从沙箱 iframe（empty.html）发，
// 外层页面挂钩抓不到，所以列表读 Vue 2 组件（元素上的 __vue__）的 props。
// 跑：spikes/platform/run.sh spikes/platform/07-engage-channels.mjs
// 只读：读列表；点「回复」图标/打开会话；Input.insertText 填「测试」→ 读回 → 全选+Backspace 清空 → 读回。
// 绝不点发送、不按 Enter、不点赞。第三方昵称/uid 打码，正文一律换成 <已脱敏>。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, saveRaw, sleep, anon, clip } = L;

const sp = await openSpace(account('Channels'));
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
const result = { comments: {}, dm: {} };

// 在 shadowRoot 里打标记，再用 page.click（CSS 选择器会搜开放的 shadow root）
const mark = (sel, tag, idx = 0) => page.evaluate(({ sel, tag, idx }) => {
  const sr = document.querySelector('wujie-app')?.shadowRoot;
  const x = sr && [...sr.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 0)[idx];
  if (!x) return false;
  x.setAttribute('data-spike', tag);
  return true;
}, { sel, tag, idx });
const inShadow = (fnSrc, arg) => page.evaluate(new Function('arg', `const sr = document.querySelector('wujie-app')?.shadowRoot; if (!sr) return null; ${fnSrc}`), arg ?? null);

async function fillAndClear(tag) {
  await page.click(`[data-spike=${tag}]`, { label: 'focus input box' });
  const focused = await inShadow(`const x = sr.querySelector('[data-spike=' + arg + ']'); return !!x && (sr.activeElement === x || x.contains(sr.activeElement));`, tag);
  if (!focused) return { focused, filled: null, cleared: null };
  await page.cdp('Input.insertText', { text: '测试' });
  await sleep(600);
  const read = () => inShadow(`const x = sr.querySelector('[data-spike=' + arg + ']'); return x ? ((x.tagName === 'TEXTAREA' || x.tagName === 'INPUT') ? x.value : x.innerText).trim() : '<gone>';`, tag);
  const filled = await read();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await sleep(600);
  const cleared = await read();
  return { focused, filled, cleared, ok: filled === '测试' && cleared === '' };
}
const describe = (tag) => inShadow(`const x = sr.querySelector('[data-spike=' + arg + ']'); if (!x) return null; return { tag: x.tagName, cls: String(x.className).slice(0, 60), placeholderStartsWith: (x.getAttribute('placeholder') || x.getAttribute('data-placeholder') || '').slice(0, 3), inIframe: false, shadow: 'wujie-app shadowRoot' };`, tag);
// 文本框候选：可见的 textarea / contenteditable / 文本 input（排除搜索框和开关）
const BOX = 'textarea, [contenteditable=true], input[type=text]';
const countBoxes = () => inShadow(`return [...sr.querySelectorAll('${BOX}')].filter((x) => x.getBoundingClientRect().height > 0 && !/search|switch/i.test(x.className)).map((x) => x.tagName + '.' + String(x.className).slice(0, 40));`);

// —— 评论 ——
await page.goto('https://channels.weixin.qq.com/platform/interaction/comment', { waitUntil: 'commit', timeout: 30000 });
await sleep(10000);
// 左侧作品列表：.comment-feed-wrap，每项有 .feed-comment-total。挑第一个评论数 >0 的作品
const feeds = await inShadow(`return [...sr.querySelectorAll('.comment-feed-wrap')].map((e, i) => ({ i, title: (e.querySelector('.feed-title')?.innerText || '').slice(0, 12), total: Number(e.querySelector('.feed-comment-total')?.innerText?.trim() || 0) }));`);
result.comments.feedCount = feeds?.length ?? 0;
const target = feeds?.find((f) => f.total > 0);
if (target) {
  await mark('.comment-feed-wrap', 'feed', target.i);
  await page.click('[data-spike=feed]', { label: 'open post comments' });
  await sleep(5000);
  const list = await inShadow(`return [...sr.querySelectorAll('.comment-item')].map((e) => e.__vue__?.$props?.dataSource).filter(Boolean).map((c) => ({ commentId: c.commentId, nickname: c.commentNickname, username: c.username, content: c.commentContent, createtime: c.commentCreatetime, readFlag: c.readFlag, visibleFlag: c.visibleFlag, likeCount: c.commentLikeCount, replies: (c.levelTwoComment || []).map((r) => ({ commentId: r.commentId, nickname: r.commentNickname, username: r.username, replyCommentId: r.replyCommentId, content: r.commentContent })) }));`);
  const me = (await inShadow(`return [...sr.querySelectorAll('.comment-author-bandage')].length;`)) ?? 0;
  result.comments.source = '<wujie-app> shadowRoot 里 .comment-item 元素的 Vue 2 实例 __vue__.$props.dataSource（一级评论，levelTwoComment 是楼中楼）';
  result.comments.feed = { title: target.title, total: target.total };
  result.comments.count = list?.length ?? 0;
  result.comments.authorBadges = me;
  result.comments.sample = (list ?? []).slice(0, 3).map((c) => ({ commentId: c.commentId, nickname: anon(c.nickname), uid: anon(c.username), text: clip(c.content), time: c.createtime ? new Date(Number(c.createtime) * 1000).toISOString() : null, read: c.readFlag, replyCount: c.replies.length, replies: c.replies.slice(0, 2).map((r) => ({ commentId: r.commentId, nickname: anon(r.nickname), replyTo: r.replyCommentId, text: clip(r.content) })) }));
  result.comments.rawForAuthor = (list ?? []).flatMap((c) => c.replies).map((r) => r.nickname);

  // 回复入口：.action-item 里的 .weui-icon-outlined-comment（tooltip「回复」）。旁边的 .like-action 是点赞，不碰
  if (await mark('.comment-item .weui-icon-outlined-comment', 'reply0')) {
    await page.click('[data-spike=reply0]', { label: 'open reply input' });
    await sleep(1500);
    const boxes = await countBoxes();
    result.comments.boxCandidates = boxes;
    if (boxes?.length === 1 && await inShadow(`const x = [...sr.querySelectorAll('${BOX}')].filter((x) => x.getBoundingClientRect().height > 0 && !/search|switch/i.test(x.className))[0]; x.setAttribute('data-spike', 'replybox'); return true;`)) {
      result.comments.replyBox = await describe('replybox');
      result.comments.fill = await fillAndClear('replybox');
    }
  }
}
await sleep(2000);

// —— 私信 ——
await page.goto('https://channels.weixin.qq.com/platform/private_msg', { waitUntil: 'commit', timeout: 30000 });
await sleep(10000);
// messageList 是新到旧排的（11-19 实测 [0] 最新），取 ts 最大的那条，不要用 at(-1)
// 会话列表：.session-wrap 往上找到有 $data.sessionList 的 Vue 实例；每项是 [sessionId, {sessionInfo, messageList, newMsgCount, sessionIsUnread}]
const convs = await inShadow(`let v = null; for (let x = sr.querySelector('.session-wrap'), i = 0; x && i < 6 && !v; x = x.parentElement, i++) if (x.__vue__?.$data?.sessionList) v = x.__vue__;
  if (!v) return null;
  return v.$data.sessionList.map(([id, s]) => { const m = [...(s.messageList ?? [])].map((x) => x.message).sort((p, q) => Number(q.ts) - Number(p.ts))[0] ?? null; const peer = s.sessionInfo?.username;
    return { sessionId: id, peer, nickname: s.sessionInfo?.nickname, fromUserType: s.sessionInfo?.fromUserType, unread: s.sessionIsUnread, newMsgCount: s.newMsgCount,
      last: m && { msgType: m.msgType, ts: m.ts, from: m.fromUsername, text: m.textMsg?.content ?? null, textKeys: m.textMsg ? Object.keys(m.textMsg) : null, byPeer: m.fromUsername === peer } }; });`);
result.dm.source = '<wujie-app> shadowRoot：.session-wrap 往上的 Vue 2 实例 $data.sessionList（[sessionId, {sessionInfo, messageList, newMsgCount, sessionIsUnread}]）；最后一句取 messageList 里 ts 最大的（列表是新到旧，只带最近 2 条）message.fromUsername 与 sessionInfo.username 比，相等是对方说的';
result.dm.count = convs?.length ?? 0;
result.dm.textKeys = convs?.find((c) => c.last?.textKeys)?.last.textKeys ?? null;
result.dm.sample = (convs ?? []).slice(0, 3).map((c) => ({ sessionId: anon(c.sessionId), peerUid: anon(c.peer), peerNickname: anon(c.nickname), unread: c.unread, lastType: c.last?.msgType, lastBy: c.last ? (c.last.byPeer ? 'peer' : 'me') : null, lastAt: c.last?.ts ? new Date(Number(c.last.ts) * (String(c.last.ts).length > 11 ? 1 : 1000)).toISOString() : null, lastMessage: clip(c.last?.text) }));

result.dm.tried = [];
for (let i = 0; i < 3 && !result.dm.fill; i++) {
  if (!(await mark('.session-wrap', `conv${i}`, i))) break;
  await page.click(`[data-spike=conv${i}]`, { label: 'open a conversation' });
  await sleep(4000);
  const boxes = await countBoxes();
  result.dm.tried.push({ index: i, boxes });
  if (boxes?.length === 1) {
    await inShadow(`[...sr.querySelectorAll('${BOX}')].filter((x) => x.getBoundingClientRect().height > 0 && !/search|switch/i.test(x.className))[0].setAttribute('data-spike', 'dmbox'); return true;`);
    result.dm.inputBox = await describe('dmbox');
    result.dm.fill = await fillAndClear('dmbox');
  }
}

const verdictOf = (r) => (r?.fill?.ok && r.count > 0 ? '通过' : r?.count > 0 ? '部分' : '不通过');
result.verdict = { comments: verdictOf(result.comments), dm: verdictOf(result.dm) };
await saveRaw('07-channels', { feeds, convs });
const authorNames = result.comments.rawForAuthor;
delete result.comments.rawForAuthor;
result.comments.lv2Nicknames = [...new Set(authorNames ?? [])].map(anon);
console.log(JSON.stringify(result, null, 1));
