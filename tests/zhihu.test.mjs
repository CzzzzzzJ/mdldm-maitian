import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zhihuCopy, zhihuStats, zhihuVideoId, zhihuFollowerCount, waitsForUser } from '../src/zhihu.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('发布素材的知乎节能取出标题、简介和话题', () => {
  const section = '**标题：**\n这是一条知乎视频标题\n**简介：**\n讲清楚这件事。\n**话题：**\n#人工智能 #效率';
  assert.deepEqual(zhihuCopy(section), {
    title: '这是一条知乎视频标题',
    body: '讲清楚这件事。',
    topics: ['人工智能', '效率'],
  });
});

test('没有单独话题行时，简介最后一行的话题也会拆出来', () => {
  const section = '**标题：**\n五个字以上的标题\n**简介：**\n正文一行\n#效率 #工具';
  assert.deepEqual(zhihuCopy(section), {
    title: '五个字以上的标题',
    body: '正文一行',
    topics: ['效率', '工具'],
  });
});

test('作品数据把播放、赞同、评论、收藏对上', () => {
  assert.deepEqual(zhihuStats({ play_count: 12, voteup_count: 3, comment_count: 4, collected_count: 5 }), {
    views: 12, likes: 3, comments: 4, favorites: 5,
  });
  assert.equal(zhihuStats({ play_count: 1, liked_count: 2, comment_count: 0 }).likes, 2);
  assert.equal(zhihuStats({ play_count: 1, comment_count: 0 }).favorites, null);
  assert.equal(zhihuStats({ title: '只有标题' }), null);
  assert.equal(zhihuStats(null), null);
});

test('作品链接和粉丝数能读出来', () => {
  assert.equal(zhihuVideoId('https://www.zhihu.com/zvideo/1234567890?utm=1'), '1234567890');
  assert.equal(zhihuVideoId('https://www.zhihu.com/question/1'), '');
  assert.equal(zhihuFollowerCount({ follower_count: 99 }), 99);
  assert.equal(zhihuFollowerCount({ member: { follower_count: 7 } }), 7);
  assert.equal(zhihuFollowerCount({}), null);
  assert.equal(zhihuFollowerCount(null), null);
});

test('知乎没写进 manual 也不会被自动点发布', () => {
  assert.equal(waitsForUser('zhihu', []), true);
  assert.equal(waitsForUser('bilibili', ['bilibili']), true);
  assert.equal(waitsForUser('youtube', []), false);
  assert.equal(waitsForUser('youtube', ['youtube']), true);
  assert.equal(waitsForUser('zsz', []), false);
});

test('中文名、采集和示例配置都登记了知乎', async () => {
  process.env.MAITIAN_DB = path.join(os.tmpdir(), `mt-zhihu-${Date.now()}.db`);
  const { NAMES } = await import('../src/db.mjs');
  assert.equal(NAMES.zhihu, '知乎');
  assert.match(read('../src/metrics.mjs'), /async zhihu\(/);
  assert.match(read('../src/metrics.mjs'), /zhihuStats/);
  assert.match(read('../src/followers.mjs'), /async zhihu\(/);
  assert.match(read('../src/hub.mjs'), /zhihu: 'https:\/\/www\.zhihu\.com\/zvideo\/upload-video'/);
  assert.match(read('../src/hub.mjs'), /includes\('zhihu'\) \? \['zhihu'\] : \[\]/);
  assert.doesNotMatch(read('../src/hub.mjs'), /'channels', 'zhihu'/);
  assert.match(read('../src/web.mjs'), /includes\('zhihu'\) \? \['zhihu'\] : \[\]/);
  assert.match(read('../src/followers.mjs'), /includes\('zhihu'\)/);
  assert.match(read('../src/web/mt.js'), /zhihu: '知乎'/);
  assert.match(read('../skills/maitian-publish/SKILL.md'), /## 十一、知乎/);
  assert.match(read('../skills/maitian-publish/SKILL.md'), /可选/);
  const cfg = JSON.parse(read('../config.example.json'));
  assert.equal(cfg.batches.flat().includes('zhihu'), false);
  assert.equal(cfg.manual.includes('zhihu'), false);
  assert.equal(cfg.auto.includes('zhihu'), false);
});

test('飞书卡片把知乎状态行排成平台行', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-zh-fs-'));
  process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ name: '麦田', feishuWebhook: 'https://saved' }));
  const { toCard } = await import(`../src/feishu.mjs?zhihu=${Date.now()}`);
  const card = toCard('📋 一期\n知乎：待你点发布 https://www.zhihu.com/zvideo/1');
  assert.match(JSON.stringify(card), /\*\*知乎\*\*/);
});
