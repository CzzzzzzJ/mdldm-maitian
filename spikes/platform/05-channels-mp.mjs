// ⑤ 视频号与公众号同在 Profile 5，会不会互踢。
// 顺序：读视频号 auth_data → 打开公众号后台读登录态 → 再读视频号 → 隔 waitMin 分钟各读一次。
// 另列两边 cookie 的名字/domain/path（不取值），找同名同 domain 冲突。
// 跑：spikes/platform/run.sh spikes/platform/05-channels-mp.mjs
//     扫码后复测（收回交给用户的 space）：spikes/platform/run.sh spikes/platform/05-channels-mp.mjs '{"takeOver":true}'
//     缩短间隔：'{"waitMin":1}'
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, getJson, saveRaw, sleep } = L;
// minutes>0 时改跑长时间线：每 everySec 秒一轮，两边交替刷新页面、读接口，直到满 minutes 分钟（2026-11-19 用 35 分钟）
const args = { waitMin: 10, minutes: 0, everySec: 180, takeOver: false, ...(globalThis.ARGS ?? {}) };

const ch = await openSpace(account('Channels'), { takeOver: args.takeOver });
const mp = await openSpace(account('GongZhongHao'), { takeOver: args.takeOver });
if (!ch.task || !mp.task) {
  console.log(JSON.stringify({ verdict: '等扫码', reason: 'space 在用户手里，加 {"takeOver":true} 复测', ch: ch.state, mp: mp.state }));
  process.exit(0);
}
const chPage = await mainPage(ch.task);
const mpPage = await mainPage(mp.task);

async function readChannels(reload = false) {
  if (reload || !/channels\.weixin\.qq\.com\/platform/.test(await chPage.url())) {
    await chPage.goto('https://channels.weixin.qq.com/platform', { waitUntil: 'commit', timeout: 30000 });
    await sleep(6000);
  }
  const r = await getJson(chPage, '/cgi-bin/mmfinderassistant-bin/auth/auth_data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { at: new Date().toISOString(), http: r.status, errCode: r.json?.errCode, loggedIn: r.json?.errCode === 0 && !!r.json?.data?.finderUser, path: new URL(await chPage.url()).pathname };
}

async function readMp(reload) {
  if (reload || !/mp\.weixin\.qq\.com/.test(await mpPage.url())) {
    await mpPage.goto('https://mp.weixin.qq.com/', { waitUntil: 'commit', timeout: 30000 });
    await sleep(6000);
  }
  const url = await mpPage.url();
  const m = url.match(/[?&]token=(\d+)/);
  let home = null;
  if (m) {
    const r = await getJson(mpPage, `/cgi-bin/home?t=home/index&token=${m[1]}&lang=zh_CN&f=json`);
    home = { http: r.status, ret: r.json?.base_resp?.ret };
  }
  return { at: new Date().toISOString(), hasToken: !!m, path: new URL(url).pathname, home, loggedIn: !!m && (home?.ret === 0 || home?.ret === undefined) };
}

// cookie 名字（Network.getCookies 会带值，这里立刻只留 name/domain/path）
async function cookieNames(page, urls) {
  const r = await page.cdp('Network.getCookies', { urls });
  return (r.cookies ?? []).map((c) => ({ name: c.name, domain: c.domain, path: c.path, httpOnly: c.httpOnly }));
}

const timeline = [];
timeline.push({ step: '1 视频号', ...(await readChannels()) });
await sleep(2000);
timeline.push({ step: '2 公众号', ...(await readMp(true)) });
await sleep(2000);
timeline.push({ step: '3 视频号（打开公众号后）', ...(await readChannels()) });

const bothIn = timeline[0].loggedIn && timeline[1].loggedIn;
const t0 = Date.now();
const mins = () => Math.round((Date.now() - t0) / 6000) / 10;
if (bothIn && args.minutes > 0) {
  // 奇数轮刷新视频号、只读公众号接口；偶数轮反过来。每轮都打一行，后台跑时能 tail 看进度
  for (let i = 1; Date.now() - t0 < args.minutes * 60_000; i++) {
    await sleep(args.everySec * 1000);
    const c = await readChannels(i % 2 === 1);
    timeline.push({ step: `r${i} 视频号${i % 2 === 1 ? '（刷新）' : ''}`, min: mins(), ...c });
    await sleep(2000);
    const m = await readMp(i % 2 === 0);
    timeline.push({ step: `r${i} 公众号${i % 2 === 0 ? '（重开首页）' : ''}`, min: mins(), ...m });
    console.log(JSON.stringify({ round: i, min: mins(), ch: c.loggedIn, mp: m.loggedIn }));
  }
} else if (bothIn) {
  await sleep(args.waitMin * 60_000);
  timeline.push({ step: `4 视频号（+${args.waitMin}min）`, ...(await readChannels()) });
  await sleep(2000);
  timeline.push({ step: `5 公众号（+${args.waitMin}min，重新打开首页）`, ...(await readMp(true)) });
}

const chCookies = await cookieNames(chPage, ['https://channels.weixin.qq.com/', 'https://weixin.qq.com/']);
const mpCookies = await cookieNames(mpPage, ['https://mp.weixin.qq.com/', 'https://weixin.qq.com/']);
const key = (c) => `${c.name}@${c.domain}${c.path}`;
const mpKeys = new Set(mpCookies.map(key));
const conflicts = chCookies.filter((c) => mpKeys.has(key(c))).map(key);
const sharedDomain = [...new Set([...chCookies, ...mpCookies].filter((c) => /^\.?weixin\.qq\.com$/.test(c.domain)).map(key))];

let verdict;
if (!bothIn) verdict = '等扫码';
else if (timeline.every((t) => t.loggedIn)) verdict = '通过（不互踢）';
else verdict = '不通过（有一边掉线）';

const out = { verdict, waitMin: args.waitMin, timeline, cookies: { channels: chCookies, mp: mpCookies, sameNameSameDomain: conflicts, onParentDomain: sharedDomain } };
out.rawSavedTo = await saveRaw('05-channels-mp', out);
console.log(JSON.stringify(out, null, 1));
