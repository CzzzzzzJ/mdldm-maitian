import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

async function fixture(t, pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-douyin-account-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(new URL('../src/account-douyin.mjs', import.meta.url), path.join(dir, 'account-douyin.mjs'));
  fs.writeFileSync(path.join(dir, 'driver.mjs'), `
    export const withTab = async (url, fn) => fn(1);
    export const evaluate = async (id, code) => globalThis.__douyinTest.evaluate(code);
    export const click = async (id, code) => globalThis.__douyinTest.click(code);
    export const sleep = async () => {};
  `);
  let current = 0;
  const context = () => {
    const page = pages[current];
    const next = page.next === undefined ? null : { disabled: page.next === false, className: '', parentElement: null, getAttribute: () => null };
    const cards = (page.videos || []).map(video => ({ __reactFiber$test: { memoizedProps: { data: video } } }));
    return vm.createContext({ Date, document: {
      body: { innerText: page.text || '' },
      querySelectorAll: selector => selector.includes('video-card-info') ? cards : [],
      querySelector: () => next,
    } });
  };
  const original = globalThis.__douyinTest;
  globalThis.__douyinTest = {
    evaluate: code => vm.runInContext(code, context()),
    click: code => { assert.match(code, /next|下一页/i); if (!pages[current].stuck) current++; },
  };
  t.after(() => { globalThis.__douyinTest = original; });
  return import(new URL(`file://${path.join(dir, 'account-douyin.mjs')}`));
}
const video = (id, views) => ({ aweme_id: id, desc: `说明 ${id}`, item_title: `视频 ${id}`, create_time: 1700000000, statistics: { play_count: views, digg_count: 2, comment_count: 3, collect_count: 4, share_count: 5 } });

test('Douyin reads all published pages, preserves zero views, and excludes future/review items', async t => {
  const api = await fixture(t, [
    { videos: [video('101', 0), { ...video('102', 999), status: { in_reviewing: true } }], next: true },
    { videos: [video('103', 1), { ...video('104', 999), publish_time: 9999999999 }], next: false },
  ]);
  const rows = await api.collectDouyinVideos();
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { id: '101', title: '视频 101', url: 'https://www.douyin.com/video/101', publishedAt: '2023-11-14T22:13:20.000Z', views: 0, likes: 2, comments: 3, favorites: 4, shares: 5, extra: {} },
    { id: '103', title: '视频 103', url: 'https://www.douyin.com/video/103', publishedAt: '2023-11-14T22:13:20.000Z', views: 1, likes: 2, comments: 3, favorites: 4, shares: 5, extra: {} },
  ]);
});

test('Douyin rejects login and malformed video metrics instead of saving an empty success', async t => {
  await t.test('login', async t => {
    const api = await fixture(t, [{ text: '请扫码登录' }]);
    await assert.rejects(api.collectDouyinVideos(), /登录/);
  });
  await t.test('metrics', async t => {
    const api = await fixture(t, [{ videos: [{ ...video('101', 5), statistics: undefined }], next: false }]);
    await assert.rejects(api.collectDouyinVideos(), /数据|统计/);
  });
});

test('Douyin detects a next-page action that never changes the list', async t => {
  const api = await fixture(t, [{ videos: [video('101', 5)], next: true, stuck: true }]);
  await assert.rejects(api.collectDouyinVideos(), /翻页|分页/);
});

test('Douyin accepts an explicitly empty account', async t => {
  const api = await fixture(t, [{ text: '暂无作品' }]);
  assert.deepEqual(await api.collectDouyinVideos(), []);
});

test('Douyin refuses to call a visible first page complete when pagination cannot be identified', async t => {
  const api = await fixture(t, [{ videos: [video('101', 5)] }]);
  await assert.rejects(api.collectDouyinVideos(), /分页控件未识别/);
});

test('Douyin accepts a single page only with an explicit matching total', async t => {
  const api = await fixture(t, [{ videos: [video('101', 5)], text: '共 1 条' }]);
  assert.equal((await api.collectDouyinVideos()).length, 1);
});

test('Douyin rejects blank or boolean metric values instead of inventing counts', async t => {
  const api = await fixture(t, [{ videos: [{ ...video('101', 5), statistics: { play_count: '' } }], next: false }]);
  await assert.rejects(api.collectDouyinVideos(), /统计数据格式/);
});
