import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('素材生成识别 A 站和快手，旧助手提示升级并保留旧平台', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-china-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ plugin: 'local', pluginDir: tmp, chromeProfile: path.join(tmp, 'profile') }));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'publish.js'), 'export const ADAPTERS = {};');
  fs.writeFileSync(path.join(tmp, 'lib', 'bundle.js'), 'export const PLATFORMS = {bilibili:{}}; export function validate(){return {errors:[],warnings:[]}}');
  const md = path.join(tmp, '素材.md');
  fs.writeFileSync(md, '# 本期\n\n## 三、B站\n**标题：**\n原渠道\n**分区：**\n单机游戏\n\n## 十二、A站\n**标题：**\nA站标题\n**简介：**\nA站简介\n**标签：**\n#标签\n**分区：** 科技 / 人文科普\n\n## 十三、快手\n**文案：**\n快手文案\n#话题\n');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/make-publish.mjs', import.meta.url)), md, tmp], {
    encoding: 'utf8', env: { ...process.env, MAITIAN_CONFIG: cfg, MAITIAN_DB: path.join(tmp, 'hub.db'), PUBLISH_REQUIRE_TAG: '' }
  });
  assert.equal(child.status, 0, child.stderr);
  const p = JSON.parse(fs.readFileSync(path.join(tmp, 'publish.json'), 'utf8')).platforms;
  assert.equal(p.bilibili.title, '原渠道');
  assert.equal(p.bilibili.category, '单机游戏');
  assert.deepEqual(p.acfun, { covers: [], title: 'A站标题', desc: 'A站简介', tags: ['标签'], category: '科技 / 人文科普' });
  assert.deepEqual(p.kuaishou, { covers: [], caption: '快手文案\n#话题' });
  assert.match(child.stdout, /升级.*麦田发布助手/);
});

test('旧助手跳过已启用的新渠道，不打开浏览器也不改变锁定任务', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-legacy-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const cfg = path.join(tmp, 'config.json'), db = path.join(tmp, 'hub.db');
  fs.writeFileSync(cfg, JSON.stringify({ rootPath: tmp, batches: [['acfun', 'kuaishou']], auto: ['acfun', 'kuaishou'], plugin: 'local', pluginDir: tmp, chromeProfile: path.join(tmp, 'profile'), chromePort: 49189 }));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'publish.js'), 'export const ADAPTERS = {bilibili:{}};');
  fs.writeFileSync(path.join(tmp, 'lib', 'cdp.js'), 'export {}');
  fs.writeFileSync(path.join(tmp, 'lib', 'bundle.js'), 'export const PLATFORMS = {}; export const len = () => 0; export function validate(){return {errors:[],warnings:[]}}');
  fs.writeFileSync(path.join(tmp, 'publish.json'), JSON.stringify({ id: 'test', version: 1, name: 'test', video: 'sample.mp4',
    platforms: { acfun: { title: '本期' }, kuaishou: { caption: '本期' } } }));
  const hub = fileURLToPath(new URL('../src/hub.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [hub, ...args], {
    timeout: 4000, encoding: 'utf8', env: { ...process.env, HUB_DRIVER: 'direct', MAITIAN_CONFIG: cfg, MAITIAN_DB: db }
  });
  assert.equal(cli('plan', tmp).status, 0);
  assert.equal(cli('mark', 'test', 'kuaishou', 'published', '--published-at', '2026-11-27T12:34:00+08:00').status, 0);
  const lookup = cli('status', 'test', '--logs');
  assert.match(lookup.stdout, /2026-11-27 12:34:00/);
  assert.equal(cli('mark', 'test', 'kuaishou', 'pending').status, 0);
  assert.equal(cli('mark', 'test', 'acfun', 'awaiting_user', '保留这个标签页').status, 0);
  const run = cli('run', tmp, '--force');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /快手.*升级麦田发布助手/);
  assert.match(cli('status', 'test').stdout, /A站.*保留这个标签页/);
  assert.equal(fs.existsSync(path.join(tmp, 'profile')), false);
});

test('分发大屏保留 A 站与快手状态，详情展示快手文案和封面', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-china-board-'));
  process.env.MAITIAN_CONFIG = path.join(tmp, 'config.json');
  process.env.MAITIAN_DB = path.join(tmp, 'test.db');
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({
    rootPath: tmp, web: { port: 0, key: 'qa-channel-test' }, batches: [['acfun', 'kuaishou']], chromePort: 49279,
  }));
  const { db, upsertEpisode, saveSnapshot, setTask, saveMetric } = await import('../src/db.mjs');
  await import('../src/followers.mjs');
  const { startWeb } = await import('../src/web.mjs');
  const srv = startWeb();
  t.after(async () => {
    await new Promise(resolve => srv.close(resolve));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await once(srv, 'listening');
  upsertEpisode({ id: 'dual-qa', name: '双渠道联调', dir: tmp });
  saveSnapshot('dual-qa', { platforms: { acfun: { title: 'A站联调' }, kuaishou: { caption: '快手原文\n#话题', covers: ['3x4'] } } });
  setTask('dual-qa', 'acfun', 'awaiting_user', '待人工');
  setTask('dual-qa', 'kuaishou', 'published', '链接已回填', { url: 'https://www.kuaishou.com/short-video/example' });
  saveMetric('2026-11-27', 'dual-qa', 'kuaishou', { views: 42, likes: 0, comments: 1 });
  const get = async route => {
    const response = await fetch(`http://127.0.0.1:${srv.address().port}${route}`, { headers: { cookie: 'mt_key=qa-channel-test' } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const ep = await get('/api/episode?id=dual-qa');
  const ks = ep.tasks.find(t => t.platform === 'kuaishou');
  assert.equal(ks.copy.body, '快手原文\n#话题');
  assert.deepEqual(ks.copy.covers, ['3x4']);
  assert.equal(ks.url, 'https://www.kuaishou.com/short-video/example');
  assert.deepEqual([ks.m.views, ks.m.likes, ks.m.comments, ks.m.shares], [42, 0, 1, null]);
  const summary = await get('/api/overview');
  assert.deepEqual(summary.episodes[0].tasks.map(t => [t.name,t.state]), [['A站','awaiting_user'], ['快手','published']]);
});
