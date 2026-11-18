// ⑦ 抖音评论页、私信页只读适配器探针。
// 跑：spikes/platform/run.sh spikes/platform/07-engage-douyin.mjs
// 只读：读列表；点「回复」/打开会话；Input.insertText 填「测试」→ 读回 → 全选+Backspace 清空 → 读回。
// 绝不点发送、不按 Enter。第三方昵称/uid 打码，正文只留前 6 个字。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, saveRaw, sleep, anon, clip } = L;
const OWN_UID = account('Douyin').uid;

const sp = await openSpace(account('Douyin'));
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
const result = { comments: {}, dm: {} };

// 填入 → 读回 → 清空 → 读回。box 是已打上 data-spike 标记的 contenteditable/textarea
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

// —— 评论 ——
await page.goto('https://creator.douyin.com/creator-micro/interactive/comment', { waitUntil: 'commit', timeout: 30000 });
await page.waitForSelector('[class*=container-sXKyMs], [class*=operations-]', { timeout: 20000 }).catch(() => {});
await sleep(2000);

// 评论列表：评论区 Context Provider 的 value.dataSource（与接口 comment/list/select 同构）
const comments = await page.evaluate(() => {
  // 从某条评论的「回复」入口往上找 Context Provider
  const c = [...document.querySelectorAll('[class*=operations-] > div')].find((e) => e.textContent.trim() === '回复');
  if (!c) return null;
  const k = Object.keys(c).find((k) => k.startsWith('__reactFiber'));
  for (let f = c[k], i = 0; f && i < 40; f = f.return, i++) {
    const v = f.memoizedProps?.value;
    if (v && Array.isArray(v.dataSource)) {
      return { depth: i, ctxKeys: Object.keys(v), list: v.dataSource.map((x) => ({ cid: x.cid, aweme_id: x.aweme_id, uid: x.user?.uid, nickname: x.user?.nickname, text: x.text, create_time: x.create_time, reply_comment_total: x.reply_comment_total, is_author_digged: x.is_author_digged })) };
    }
  }
  return null;
});
// 已回复：只能从子回复里看作者有没有回过；列表里只有 reply_comment_total。看展开的回复里有没有作者
result.comments.source = comments ? `React Context（从评论「回复」入口的 fiber 往上 ${comments.depth} 层）value.dataSource；Context 上还有 ${comments.ctxKeys.join('/')}（写操作，不调用）` : '未读到';
result.comments.sample = (comments?.list ?? []).slice(0, 3).map((x) => ({ commentId: x.cid, postId: x.aweme_id, replyToNickname: anon(x.nickname), uid: anon(x.uid), text: clip(x.text), time: new Date(x.create_time * 1000).toISOString(), replyCount: x.reply_comment_total, authorReplied: x.reply_comment_total > 0 ? '需展开子回复判断' : false }));
result.comments.count = comments?.list.length ?? 0;

// 点第一条的「回复」入口，定位回复框
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[class*=container-] [class*=operations-] > div')].find((e) => e.textContent.trim() === '回复');
  if (!b) return false;
  b.setAttribute('data-spike', 'reply0');
  return true;
});
if (opened) {
  await page.click('[data-spike=reply0]', { label: 'open reply box' });
  await sleep(1500);
  const box = await page.evaluate(() => {
    const x = document.querySelector('[class*=reply-content-] [contenteditable=true]');
    if (!x) return null;
    x.setAttribute('data-spike', 'replybox');
    const inIframe = window !== window.top;
    let shadow = false; for (let e = x; e; e = e.parentNode) if (e instanceof ShadowRoot) shadow = true;
    return { tag: x.tagName, cls: String(x.className).replace(/-[\w]{6}\b/g, '-*'), inIframe, shadow, placeholderStartsWith: (x.getAttribute('data-placeholder') || x.innerText || '').slice(0, 3) };
  });
  result.comments.replyBox = box;
  if (box) result.comments.fill = await fillAndClear('[data-spike=replybox]');
}

await sleep(2000);

// —— 私信 ——
await page.goto('https://creator.douyin.com/creator-micro/data/following/chat', { waitUntil: 'commit', timeout: 30000 });
await page.waitForSelector('li.semi-list-item', { timeout: 30000 }).catch(() => {});
await sleep(2000);

// 会话列表：每个 li 的 fiber 往上 2 层 props.item 是 IM SDK 的 Conversation 对象
const convs = await page.evaluate(() => [...document.querySelectorAll('li.semi-list-item')].slice(0, 20).map((li) => {
  const k = Object.keys(li).find((k) => k.startsWith('__reactFiber'));
  let f = li[k]; for (let i = 0; i < 2 && f; i++) f = f.return;
  const it = f?.memoizedProps?.item;
  if (!it) return null;
  const lm = it.lastMessage;
  let text = null; try { text = JSON.parse(lm?.content ?? 'null')?.text ?? null; } catch {}
  const name = li.querySelector('[class*=item-header] , [class*=name]')?.innerText?.split('\n')[0] ?? li.innerText.split('\n')[0];
  return { id: it.id, shortId: it.shortId, peer: it.toParticipantUserId, name, isStranger: it.isStrangerChat, unread: it.unreadCount, lastText: text, lastType: lm?.type, lastFromMe: lm?.isFromMe, lastSender: lm?.sender, lastAt: lm?.createdAt ? Number(lm.createdAt) : null };
}).filter(Boolean));
result.dm.source = 'li.semi-list-item 的 React fiber 往上 2 层 memoizedProps.item（IM SDK Conversation；lastMessage.isFromMe 判断最后一句是谁说的）';
result.dm.count = convs.length;
result.dm.sample = convs.slice(0, 3).map((c) => ({ conversationId: anon(c.id), peerNickname: anon(c.name), peerUid: anon(c.peer), lastMessage: clip(c.lastText), lastType: c.lastType, lastFromMe: c.lastFromMe, lastBy: c.lastSender == null ? null : String(c.lastSender) === OWN_UID ? 'me' : 'peer', lastAt: c.lastAt ? new Date(c.lastAt).toISOString() : null, stranger: c.isStranger }));
result.dm.idNote = 'conversationId 形如 0:1:<uidA>:<uidB>，含对方 uid，样例里打码';

// 打开第一个会话（会标已读，任务允许），定位输入框，填入再清空
const firstLi = await page.evaluate(() => { const li = document.querySelector('li.semi-list-item'); if (!li) return false; li.setAttribute('data-spike', 'conv0'); return true; });
if (firstLi) {
  await page.click('[data-spike=conv0]', { label: 'open first conversation' });
  await sleep(3000);
  const box = await page.evaluate(() => {
    // 只认聊天编辑器里的输入框，别的可编辑区一律不碰
    const cands = [...document.querySelectorAll('[class*=chat-editor-] [contenteditable=true]')].filter((x) => x.getBoundingClientRect().height > 0);
    const x = cands.length === 1 ? cands[0] : null;
    if (!x) return null;
    x.setAttribute('data-spike', 'dmbox');
    let shadow = false; for (let e = x; e; e = e.parentNode) if (e instanceof ShadowRoot) shadow = true;
    const chain = []; for (let e = x, i = 0; e && i < 4; e = e.parentElement, i++) chain.push(String(e.className).split(' ')[0].replace(/-[\w]{6}$/, '-*'));
    return { n: cands.length, tag: x.tagName, chain: chain.join(' < '), inIframe: window !== window.top, shadow };
  });
  result.dm.inputBox = box;
  if (box) result.dm.fill = await fillAndClear('[data-spike=dmbox]');
}

const verdictOf = (r) => (r?.fill?.ok && r.count > 0 ? '通过' : r?.count > 0 ? '部分' : '不通过');
result.verdict = { comments: verdictOf(result.comments), dm: verdictOf(result.dm) };
await saveRaw('07-douyin', { comments, convs });
console.log(JSON.stringify(result, null, 1));
