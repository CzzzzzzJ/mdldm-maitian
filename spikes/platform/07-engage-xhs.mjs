// ⑦ 小红书评论、私信只读适配器探针。
// 创作者中心（creator.xiaohongshu.com）侧栏只有 首页/笔记管理/数据看板/… ，没有评论管理和私信页；
// 评论和私信都在主站 www.xiaohongshu.com（同一 space 的 cookie 已登录）：
//   评论：/notification「评论和@」，列表接口 /api/sns/web/v1/you/mentions
//   私信：/chat，会话列表接口 /api/im/web/v3/chats
// 跑：spikes/platform/run.sh spikes/platform/07-engage-xhs.mjs
// 只读：读列表；点「回复」/打开会话；Input.insertText 填「测试」→ 读回 → 全选+Backspace 清空 → 读回。
// 绝不点发送、不按 Enter。第三方昵称/uid 打码，正文只留前 6 个字。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { ACCOUNTS, openSpace, mainPage, saveRaw, sleep, anon, clip, installHook, captured, keyPaths } = L;
const A = ACCOUNTS.find((a) => a.home?.includes('xiaohongshu'));

const sp = await openSpace(A);
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await installHook(page);
const result = { comments: {}, dm: {} };

async function fillAndClear(sel) {
  await page.click(sel, { label: 'focus input box' });
  const focused = await page.evaluate((s) => { const x = document.querySelector(s); return !!x && (x === document.activeElement || x.contains(document.activeElement)); }, sel);
  if (!focused) return { focused, filled: null, cleared: null };
  await page.cdp('Input.insertText', { text: '测试' });
  await sleep(600);
  const read = () => page.evaluate((s) => { const x = document.querySelector(s); return x ? ('value' in x && x.tagName !== 'DIV' ? x.value : x.innerText).trim() : '<gone>'; }, sel);
  const filled = await read();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await sleep(600);
  const cleared = await read();
  return { focused, filled, cleared, ok: filled === '测试' && cleared === '' };
}
const where = (sel) => page.evaluate((s) => {
  const x = document.querySelector(s);
  if (!x) return null;
  let shadow = false; for (let e = x; e; e = e.parentNode) if (e instanceof ShadowRoot) shadow = true;
  return { tag: x.tagName, cls: String(x.className).slice(0, 60), placeholderStartsWith: (x.getAttribute('placeholder') || x.getAttribute('data-placeholder') || '').slice(0, 3), inIframe: window !== window.top, shadow };
}, sel);

// —— 评论 ——
await page.goto('https://www.xiaohongshu.com/notification', { waitUntil: 'commit', timeout: 30000 });
await sleep(6000);
// 「评论和@」是默认标签；已选中时再点一次会让列表一直不出来（11-19 实测），所以只在没选中时点
const commentsTabActive = await page.evaluate(() => /评论和@/.test(document.querySelector('[class*=tab][class*=active]')?.innerText ?? ''));
if (!commentsTabActive) await page.click('text="评论和@"', { label: 'open comments tab' });
// 列表渲染有时要 30 秒以上（接口 2 秒就回了，11-19 连跑几次都碰到），等回复入口出现再读
await page.waitForSelector('.action-reply', { timeout: 60000 }).catch(() => {});
await sleep(1500);
const mentions = (await captured(page, 'you/mentions')).at(-1)?.json;
const ml = mentions?.data?.message_list ?? [];
result.comments.source = '接口 /api/sns/web/v1/you/mentions（页面自己发，挂钩抄回）；data.message_list[]，cursor/has_more 翻页';
result.comments.count = ml.length;
result.comments.types = [...new Set(ml.map((m) => m.type))];
result.comments.keys = mentions ? [...keyPaths(mentions)].filter((k) => k.startsWith('data.message_list[]')).slice(0, 40) : null;
result.comments.sample = ml.slice(0, 3).map((m) => ({ id: m.id, type: m.type, title: m.title, time: m.time ? new Date(m.time * 1000).toISOString() : null, nickname: anon(m.user_info?.nickname), uid: anon(m.user_info?.userid ?? m.user_info?.user_id), commentId: m.comment_info?.id ?? null, text: clip(m.comment_info?.content), noteId: m.item_info?.id ?? null, replyTo: m.comment_info?.target_comment ? { id: m.comment_info.target_comment.id, byMe: m.comment_info.target_comment.user_info?.userid === A.uid || m.comment_info.target_comment.user_info?.user_id === A.uid } : null }));

const opened = await page.evaluate(() => { const b = document.querySelector('.action-reply'); if (!b) return false; b.setAttribute('data-spike', 'reply0'); return true; });
if (opened) {
  await page.click('[data-spike=reply0]', { label: 'open reply input' });
  await sleep(1500);
  const ok = await page.evaluate(() => { const c = [...document.querySelectorAll('textarea.comment-input')].filter((x) => x.getBoundingClientRect().height > 0); if (c.length !== 1) return c.length; c[0].setAttribute('data-spike', 'replybox'); return 1; });
  result.comments.replyBox = ok === 1 ? await where('[data-spike=replybox]') : { found: ok };
  if (ok === 1) result.comments.fill = await fillAndClear('[data-spike=replybox]');
}
await sleep(2000);

// —— 私信 ——
await page.goto('https://www.xiaohongshu.com/chat', { waitUntil: 'commit', timeout: 30000 });
await page.waitForSelector('.xhs-im-conv-item', { timeout: 60000 }).catch(() => {});
await sleep(1500);
const chats = (await captured(page, 'im/web/v3/chats')).at(-1)?.json;
const cl = chats?.data?.chats ?? [];
result.dm.source = '接口 /api/im/web/v3/chats（页面自己发，挂钩抄回）；data.chats[]，next_ts 翻页';
result.dm.count = cl.length;
result.dm.keys = chats ? [...keyPaths(chats)].filter((k) => k.startsWith('data.chats[]')).slice(0, 40) : null;
result.dm.sample = cl.slice(0, 3).map((c) => ({ peerUid: anon(c.chat_user_id), selfIsUserId: c.user_id === A.uid, peerNickname: anon(c.info?.nickname ?? c.nickname), lastMessage: clip(c.last_msg_content), lastAt: c.last_msg_time ? new Date(Number(c.last_msg_time)).toISOString() : null, unread: c.unread_count ?? c.info?.unread_count ?? null }));

// 依次打开前 3 个会话（会标已读，任务允许），找到有输入框的那个，填入再清空。
// 官方号推送（如「[笔记] 📢…」）的会话没有输入框，要跳过
result.dm.tried = [];
for (let i = 0; i < 3 && !result.dm.fill; i++) {
  const has = await page.evaluate((k) => {
    const item = document.querySelectorAll('.xhs-im-conv-item')[k];
    if (!item) return false;
    item.setAttribute('data-spike', `conv${k}`);
    return true;
  }, i);
  if (!has) break;
  await page.click(`[data-spike=conv${i}]`, { label: 'open a conversation' });
  await page.waitForSelector('.xhs-im-input-bar-editor', { timeout: 15000 }).catch(() => {});
  await sleep(1000);
  const n = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[contenteditable=true], textarea')].filter((x) => x.getBoundingClientRect().height > 0 && !/search/i.test(x.className));
    if (c.length === 1) c[0].setAttribute('data-spike', 'dmbox');
    return { n: c.length, list: c.map((x) => `${x.tagName}.${String(x.className).slice(0, 40)}`) };
  });
  result.dm.tried.push({ index: i, inputCandidates: n });
  if (n.n === 1) { result.dm.inputBox = await where('[data-spike=dmbox]'); result.dm.fill = await fillAndClear('[data-spike=dmbox]'); }
}

const verdictOf = (r) => (r?.fill?.ok && r.count > 0 ? '通过' : r?.count > 0 ? '部分' : '不通过');
result.verdict = { comments: verdictOf(result.comments), dm: verdictOf(result.dm) };
await saveRaw('07-xhs', { mentions, chats });
console.log(JSON.stringify(result, null, 1));
