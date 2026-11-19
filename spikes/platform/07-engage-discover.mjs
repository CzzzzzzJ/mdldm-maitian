// ⑦ 视频号、小红书评论页/私信页的第一轮探查（只读，不填任何输入框）。等扫码：space 交给用户时直接退出。
// 跑（扫码后）：spikes/platform/run.sh spikes/platform/07-engage-discover.mjs '{"platform":"Channels","takeOver":true}'
//              spikes/platform/run.sh spikes/platform/07-engage-discover.mjs '{"platform":"XiaoHongShu","takeOver":true}'
// 输出：页面自己发的评论/私信接口路径和键名；页面里可编辑区的位置（是否在 iframe/shadow DOM）。
// 填入再清空那一步要在看过这里的输出、确认输入框选择器后，照 07-engage-douyin.mjs 的 fillAndClear 另写。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, saveRaw, sleep, installHook, captured, pathOnly, keyPaths } = L;
const args = globalThis.ARGS ?? {};

// 入口地址：视频号助手的互动管理；小红书创作者中心没有固定的私信页，先从首页导航里找
const PAGES = {
  Channels: { comments: 'https://channels.weixin.qq.com/platform/interaction/comment', dm: 'https://channels.weixin.qq.com/platform/private_msg', home: 'https://channels.weixin.qq.com/platform' },
  XiaoHongShu: { comments: null, dm: null, home: 'https://creator.xiaohongshu.com/new/home' },
};
const cfg = PAGES[args.platform];
if (!cfg) throw new Error('platform 要写 Channels 或 XiaoHongShu');

const sp = await openSpace(account(args.platform), { takeOver: !!args.takeOver });
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await installHook(page);

// 导航里含「评论」「私信」「互动」的链接（视频号助手的页面在 wujie 微前端的 shadowRoot 里）
await page.goto(cfg.home, { waitUntil: 'commit', timeout: 30000 });
await sleep(8000);
if (/login/.test(await page.url())) { console.log(JSON.stringify({ verdict: '等扫码', reason: '跳到登录页' })); process.exit(0); }
const nav = await page.evaluate(() => {
  const roots = [document, ...[...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
  return roots.flatMap((r) => [...r.querySelectorAll('a[href], [class*=menu] *')].filter((a) => /评论|私信|互动|消息/.test(a.textContent) && a.textContent.trim().length < 12).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute?.('href') ?? null }))).slice(0, 20);
});

async function probe(url) {
  if (!url) return null;
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await sleep(10000);
  const apis = (await captured(page, 'comment|msg|message|session|conversation|chat')).map((c) => ({ path: pathOnly(c.url), keys: c.json ? [...keyPaths(c.json)].slice(0, 50) : null }));
  const editables = await page.evaluate(() => {
    const out = [];
    const scan = (root, where) => {
      for (const x of root.querySelectorAll('[contenteditable=true], textarea, input[type=text]')) {
        out.push({ where, tag: x.tagName, cls: String(x.className).slice(0, 60), ph: x.getAttribute('placeholder') || x.getAttribute('data-placeholder') || null, visible: x.getBoundingClientRect().height > 0 });
      }
      for (const e of root.querySelectorAll('*')) if (e.shadowRoot) scan(e.shadowRoot, `shadow:${e.tagName.toLowerCase()}`);
    };
    scan(document, 'document');
    return { list: out, iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.split('?')[0]).slice(0, 8) };
  });
  return { url: (await page.url()).split('?')[0], apis, editables };
}

const out = { platform: args.platform, nav, comments: await probe(cfg.comments), dm: await probe(cfg.dm) };
await saveRaw(`07-discover-${args.platform}`, out);
console.log(JSON.stringify(out, null, 1));
