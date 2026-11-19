// 0：Profile 5 里每个「平台×账号」一个长期 space（幂等：同名复用），打开创作者后台首页，判断登录。
// 跑：spikes/platform/run.sh spikes/platform/spaces.mjs
//     只跑部分平台：spikes/platform/run.sh spikes/platform/spaces.mjs '{"only":["Douyin"]}'
//     未登录的平台打开登录页并交给用户：加 "handoff":true
// 不 finish()：这些 space 是长期的，页面 p1 留在 space 里。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { ACCOUNTS, openSpace, mainPage, getJson, saveRaw, sleep } = L;
const args = globalThis.ARGS ?? {};

// 每个平台：打开首页后怎么判断登录。返回 { state: 'ok'|'out'|'unknown', evidence, uidSeen, loginUrl }
const CHECKS = {
  async Douyin(page, a) {
    const r = await getJson(page, '/web/api/media/user/info/');
    const sc = r.json?.status_code;
    const uid = r.json?.user?.uid ?? r.json?.user_info?.uid;
    return { state: sc === 0 ? 'ok' : sc === 8 ? 'out' : 'unknown', evidence: `GET /web/api/media/user/info/ http=${r.status} status_code=${sc}`, uidSeen: uid, raw: r.json, loginUrl: 'https://creator.douyin.com/' };
  },
  async XiaoHongShu(page) {
    const r = await getJson(page, '/api/galaxy/creator/home/personal_info');
    const code = r.json?.code;
    const d = r.json?.data ?? {};
    const atLogin = /\/login/.test(await page.url());
    return { state: code === 0 || r.json?.success === true ? 'ok' : code === -100 || r.status === 401 || atLogin ? 'out' : 'unknown', evidence: `GET /api/galaxy/creator/home/personal_info http=${r.status} code=${code} success=${r.json?.success}；页面${atLogin ? '跳到 /login' : '没跳登录页'}`, uidSeen: d.user_id ?? d.userId ?? d.red_id, raw: r.json, loginUrl: 'https://creator.xiaohongshu.com/login' };
  },
  async Bili(page) {
    const r = await getJson(page, 'https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
    const code = r.json?.code;
    return { state: code === 0 && r.json?.data?.isLogin ? 'ok' : code === -101 ? 'out' : 'unknown', evidence: `GET api.bilibili.com/x/web-interface/nav http=${r.status} code=${code} isLogin=${r.json?.data?.isLogin}`, uidSeen: r.json?.data?.mid, raw: { code, isLogin: r.json?.data?.isLogin }, loginUrl: 'https://passport.bilibili.com/login' };
  },
  async GongZhongHao(page, a) {
    const url = await page.url();
    const hasToken = /[?&]token=\d+/.test(url);
    const hasGh = hasToken ? await page.evaluate((gh) => document.documentElement.innerHTML.includes(gh), a.uid) : false;
    return { state: hasToken ? 'ok' : 'out', evidence: `落地 URL ${hasToken ? '带 token 参数（值不记）' : '不带 token'}；页面含 ${a.uid}=${hasGh}`, uidSeen: hasGh ? a.uid : null, loginUrl: 'https://mp.weixin.qq.com/' };
  },
  async Weibo(page, a) {
    const r = await getJson(page, `/ajax/profile/info?uid=${a.uid}`);
    // 登录时页面全局配置里有自己的 uid；未登录会跳到访客/登录页
    const me = await page.evaluate(() => { try { return String(window.$CONFIG?.user?.idstr ?? window.__INITIAL_STATE__?.config?.user?.idstr ?? ''); } catch { return ''; } });
    const ok = r.json?.ok;
    const url = await page.url();
    const state = /passport|login|visitor/.test(url) || ok === -100 ? 'out' : me ? 'ok' : ok === 1 ? 'unknown' : 'unknown';
    return { state, evidence: `GET /ajax/profile/info http=${r.status} ok=${ok}；页面配置里的自己 uid ${me ? '有' : '无'}；URL host=${new URL(url).host}`, uidSeen: me || null, loginUrl: 'https://passport.weibo.com/sso/signin' };
  },
  async Channels(page) {
    const url = await page.url();
    const r = await getJson(page, '/cgi-bin/mmfinderassistant-bin/auth/auth_data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    const err = r.json?.errCode;
    const fu = r.json?.data?.finderUser;
    const state = err === 0 && fu ? 'ok' : /login/.test(url) || (err != null && err !== 0) ? 'out' : 'unknown';
    return { state, evidence: `POST auth/auth_data http=${r.status} errCode=${err} finderUser=${fu ? '有' : '无'}；URL path=${new URL(url).pathname}`, uidSeen: fu?.uniqId ?? fu?.finderUsername ?? null, raw: { errCode: err, errMsg: r.json?.errMsg, dataKeys: Object.keys(r.json?.data ?? {}) }, loginUrl: 'https://channels.weixin.qq.com/login.html' };
  },
  async X(page) {
    const url = await page.url();
    const handle = await page.evaluate(() => { const b = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'); const m = b && b.innerText.match(/@\w+/); return m ? m[0] : null; });
    return { state: handle ? 'ok' : /login|flow/.test(url) || new URL(url).pathname === '/' ? 'out' : 'unknown', evidence: `URL path=${new URL(url).pathname}；侧栏账号按钮 ${handle ? '有' : '无'}`, uidSeen: handle, loginUrl: 'https://x.com/i/flow/login' };
  },
  async YouTube(page) {
    const url = await page.url();
    const m = url.match(/\/channel\/(UC[\w-]+)/);
    const host = new URL(url).host;
    return { state: m ? 'ok' : /accounts\.google/.test(host) ? 'out' : 'unknown', evidence: `落地 host=${host} path=${m ? '/channel/<id>' : new URL(url).pathname}`, uidSeen: m?.[1] ?? null, loginUrl: 'https://studio.youtube.com/' };
  },
  async Instagram(page) {
    const r = await page.evaluate(() => {
      const login = !!document.querySelector('input[name="username"], input[name="email"], input[name="pass"]');
      const i = [...document.querySelectorAll('a[href] img[alt]')].find((i) => /的头像|profile picture/i.test(i.alt) && i.getBoundingClientRect().x < 150);
      // 会话过期但记住了账号时显示「Continue / Use another profile」，也算未登录（不点 Continue）
      const remembered = /Use another profile|使用其他/.test(document.body.innerText);
      return { login: login || remembered, user: i ? i.closest('a').getAttribute('href').replace(/\//g, '') : null };
    });
    return { state: r.user ? 'ok' : r.login ? 'out' : 'unknown', evidence: `登录表单或「Continue/Use another profile」 ${r.login ? '有' : '无'}；左侧栏头像 ${r.user ? '有' : '无'}`, uidSeen: r.user, loginUrl: 'https://www.instagram.com/accounts/login/' };
  },
};

const rows = [];
const raw = {};
for (const a of ACCOUNTS) {
  if (args.only && !args.only.includes(a.code)) continue;
  const sp = await openSpace(a, { takeOver: !!args.takeOver });
  const row = { platformCode: a.code, spaceName: sp.name, spaceId: sp.id, created: sp.created, ownership: sp.state };
  rows.push(row);
  if (!sp.task) { row.login = sp.state === 'awaiting_user' ? 'awaiting_user' : 'unknown'; row.evidence = `space 在用户手里（${sp.state}），没动`; continue; }
  if (!a.home) { row.login = 'unknown'; row.evidence = '没有后台地址（config.json 未配置 site.admin），只建了 space'; continue; }
  try {
    const page = await mainPage(sp.task);
    row.page = page.label;
    // 创作者后台多是长轮询 SPA，等 domcontentloaded 会超时；commit 后固定等几秒
    await page.goto(a.home, { timeout: 30000, waitUntil: 'commit' });
    await sleep(6000);
    const c = await CHECKS[a.code](page, a);
    row.login = c.state;
    row.evidence = c.evidence;
    row.uidMatch = a.uid === 'pending' ? (c.uidSeen ? `看到 ${c.uidSeen}` : '未知') : c.uidSeen == null ? '未读到' : String(c.uidSeen) === a.uid ? '一致' : `不一致（看到 ${c.uidSeen}）`;
    raw[a.code] = c.raw ?? null;
    if (c.state !== 'ok' && args.handoff) {
      await page.goto(c.loginUrl, { timeout: 30000, waitUntil: 'commit' });
      await sp.task.handOff();
      row.login = 'awaiting_user';
      row.evidence += '；已打开登录页并 handOff()';
    }
  } catch (e) {
    row.login = 'unknown';
    row.evidence = `出错：${String(e.message || e).slice(0, 160)}`;
  }
  await sleep(2000);
}
const file = await saveRaw('spaces', { at: new Date().toISOString(), rows, raw });
console.log(JSON.stringify({ rows, rawSavedTo: file }, null, 1));
