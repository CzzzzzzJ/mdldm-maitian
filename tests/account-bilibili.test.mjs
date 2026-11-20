import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../src/account-bilibili.mjs', import.meta.url));
const video = (i, views = i) => ({
  Archive: { aid: 1000 + i, bvid: 'BV1test' + String(i).padStart(5, '0'), title: '已发布视频 ' + i, pubdate: 1794873600, ctime: 1794787200, state: 0 },
  stat: { aid: 1000 + i, view: views, like: 2, reply: 3, favorite: 4, share: 5, coin: 6, danmaku: 7 },
});
const page = (rows, count, pn = 1) => ({ code: 0, message: '0', data: { arc_audits: rows, page: { pn, ps: 50, count } } });

async function browser(t, respond) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-bilibili-account-'));
  const key = dir, calls = [], waits = [], opened = [];
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis[key]; });
  fs.copyFileSync(source, path.join(dir, 'account-bilibili.mjs'));
  fs.writeFileSync(path.join(dir, 'driver.mjs'), `
    import vm from 'node:vm';
    const b = globalThis[${JSON.stringify(key)}];
    export async function withTab(url, run) { b.opened.push(url); return run(1); }
    export async function evaluate(tab, expression) {
      return JSON.parse(JSON.stringify(await vm.runInNewContext(expression, b.context, { timeout: 1000 })));
    }
    export async function sleep(ms) { b.waits.push(ms); }
  `);
  globalThis[key] = { waits, opened, context: { AbortSignal, fetch: async (resource, options) => {
    const url = new URL(resource, 'https://member.bilibili.com');
    calls.push({ url, options });
    assert.equal(url.pathname, '/x/web/archives');
    assert.equal(url.searchParams.get('status'), 'pubed');
    assert.equal(url.searchParams.get('ps'), '50');
    assert.equal(options.credentials, 'include');
    assert.ok(options.signal instanceof AbortSignal);
    return respond(Number(url.searchParams.get('pn')));
  } } };
  return { ...(await import(pathToFileURL(path.join(dir, 'account-bilibili.mjs')).href)), calls, waits, opened };
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('collects all published pages with stable IDs, titles, dates and zero or one view', async t => {
  const b = await browser(t, pn => response(pn === 1 ? page(Array.from({ length: 50 }, (_, i) => video(i)), 51) : page([video(50)], 51, 2)));
  const result = await b.collectBilibiliVideos();
  assert.equal(result.length, 51);
  assert.deepEqual(result[0], { id: 'BV1test00000', title: '已发布视频 0', url: 'https://www.bilibili.com/video/BV1test00000/', publishedAt: '2026-11-17T00:00:00.000Z', views: 0, likes: 2, comments: 3, favorites: 4, shares: 5, extra: { 投币: 6, 弹幕: 7 } });
  assert.equal(result[1].views, 1);
  assert.equal(result[50].id, 'BV1test00050');
  assert.deepEqual(b.calls.map(c => c.url.searchParams.get('pn')), ['1', '2']);
  assert.deepEqual(b.opened, ['https://member.bilibili.com/platform/upload-manager/article']);
  assert.equal(b.waits.length, 1);
  assert.ok(b.waits[0] >= 500 && b.waits[0] <= 2000);
});

test('a successful empty published list returns no videos without another request', async t => {
  const b = await browser(t, () => response(page([], 0)));
  assert.deepEqual(await b.collectBilibiliVideos(), []);
  assert.equal(b.calls.length, 1);
});

test('rejects auth failures, malformed responses and incomplete pages without returning partial data', async t => {
  const cases = [
    ['HTTP login failure', () => response({ code: -101, message: '账号未登录' }, 401)],
    ['API login failure', () => response({ code: -101, message: '账号未登录' })],
    ['API error', () => response({ code: -500, message: 'server error' })],
    ['missing list', () => response({ code: 0, data: { page: { count: 0 } } })],
    ['missing page count', () => response({ code: 0, data: { arc_audits: [] } })],
    ['bad video ID', () => response(page([{ ...video(1), Archive: { ...video(1).Archive, bvid: 'bad' } }], 1))],
    ['missing view count', () => response(page([{ ...video(1), stat: { like: 1 } }], 1))],
    ['truncated list', () => response(page([video(1)], 51))],
    ['later failure', pn => response(pn === 1 ? page(Array.from({ length: 50 }, (_, i) => video(i)), 51) : { code: -101 })],
    ['HTML login redirect', () => new Response('<html>login</html>', { status: 200 })],
  ];
  for (const [name, respond] of cases) await t.test(name, async t => {
    const b = await browser(t, respond);
    await assert.rejects(b.collectBilibiliVideos(), /B站/);
  });
});

test('fails explicitly when history exceeds the bounded page limit', async t => {
  const b = await browser(t, pn => response(page(Array.from({ length: 50 }, (_, i) => video((pn - 1) * 50 + i)), 10001, pn)));
  await assert.rejects(b.collectBilibiliVideos(), /B站.*(?:上限|完整)/);
  assert.equal(b.calls.length, 1, 'refuse oversized history before requesting more pages');
});
