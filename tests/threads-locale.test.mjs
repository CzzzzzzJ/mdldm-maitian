// Threads 网页文案跟界面语言走。下面的按钮标签和粉丝数字样是 2026-11-24 在 threads.com 公开页面上
// （未登录状态，界面语言分别设成 zh-CN、zh-TW、zh-HK、en-US）读回来的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-threads-locale-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, '{}');
const { num, TH_FOLLOWERS, thActionsJs } = await import('../src/metrics.mjs');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// 各语言串文页上的按钮标签，顺序：赞、转发、分享
const PAGE = {
  'zh-CN': ['赞', '转发', '分享'],
  'zh-TW': ['讚', '轉發', '分享'],
  'zh-HK': ['讚好', '轉發', '分享'],
  'en-US': ['Like', 'Repost', 'Share'],
};

// 最小的假页面：每个按钮是一个带 aria-label 的 svg，外面包一层按钮，数字是按钮文字
function fakeDocument(buttons) {
  const svgs = buttons.map(([label, text]) => ({
    getAttribute: (k) => (k === 'aria-label' ? label : null),
    querySelector: () => null,
    closest: () => ({ innerText: text }),
  }));
  return { querySelectorAll: (sel) => (sel === 'svg' ? svgs : []) };
}
const run = (buttons) => vm.runInNewContext(thActionsJs, { document: fakeDocument(buttons) });

test('Threads 互动：简体、台湾繁体、香港繁体、英文界面都能读到赞、转发、分享', () => {
  for (const [locale, labels] of Object.entries(PAGE)) {
    const counts = ['16', '1', ''];   // 分享数为 0：按钮上没有数字
    const r = run(labels.map((l, i) => [l, counts[i]]));
    assert.equal(r.likes, '16', locale);
    assert.equal(r.reposts, '1', locale);
    assert.equal(r.shares, '0', locale);
  }
});

test('Threads 互动：原来就认的「回复 / Reply」照旧能读到', () => {
  assert.equal(run([['赞', '2'], ['回复', '5'], ['转发', ''], ['分享', '']]).comments, '5');
  assert.equal(run([['Like', '2'], ['Reply', '5'], ['Repost', ''], ['Share', '']]).comments, '5');
});

test('Threads 互动：一个按钮都认不出时返回 null，不写成 0', () => {
  assert.equal(run([['Threads', ''], ['更多', '']]), null);
});

test('Threads 粉丝数：简体、繁体、英文的主页字样', () => {
  const pick = (s) => (s.match(TH_FOLLOWERS) || [])[1] || '';
  // 页面上数字和「万 / 萬」之间是不换行空格（U+00A0）
  assert.equal(num(pick('578.3 万位粉丝')), 5783000);
  assert.equal(num(pick('578.3 萬位粉絲')), 5783000);   // zh-TW、zh-HK 相同
  assert.equal(num(pick('5.7M followers')), 5700000);
  assert.equal(num(pick('185位粉丝')), 185);
  assert.equal(num(pick('185位粉絲')), 185);
  assert.equal(num(pick('185 followers')), 185);
  assert.equal(pick('追蹤'), '');
});

test('num：繁体的「萬」和简体的「万」一样换算', () => {
  assert.equal(num('1.2万'), 12000);
  assert.equal(num('1.2萬'), 12000);
  assert.equal(num('578.3 萬'), 5783000);
  assert.equal(num('6,017'), 6017);
  assert.equal(num('5.3K'), 5300);
});
