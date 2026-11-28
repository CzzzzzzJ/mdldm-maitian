import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

test('archive notes are authenticated, validated, revisioned and never update publish data', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maitian-archive-test-'));
  process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
  process.env.MAITIAN_DB = path.join(dir, 'test.db');
  await writeFile(process.env.MAITIAN_CONFIG, JSON.stringify({ rootPath: dir, web: { port: 0, key: 'archive-test' } }));
  const file = path.join(dir, 'publish.json');
  const project = { id: 'ep', series: '旧系列', episode: 2, platforms: { youtube: { title: '原稿', description: '正文', tags: ['趋势'] } } };
  await writeFile(file, JSON.stringify(project));
  const { db, upsertEpisode, setTask, getTask, saveSnapshot, getSnapshot } = await import('../src/db.mjs');
  const { config } = await import('../src/feishu.mjs');
  const { startWeb } = await import('../src/web.mjs');
  upsertEpisode({ id: 'ep', episode: 1, name: '原记录', dir });
  setTask('ep', 'youtube', 'published');
  saveSnapshot('ep', project);
  upsertEpisode({ id: 'legacy', name: '旧记录', dir: path.join(dir, 'unavailable') });
  const server = startWeb();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await rm(dir, { recursive: true, force: true }); });
  await once(server, 'listening');
  const host = `http://127.0.0.1:${server.address().port}`;
  const endpoint = host + '/api/archive-notes?id=ep', headers = { cookie: 'mt_key=archive-test' };
  const read = (id = 'ep') => fetch(host + '/api/archive-notes?id=' + id, { headers });
  const post = (data, extra = {}, raw = false) => fetch(endpoint, { method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', ...extra }, body: raw ? data : JSON.stringify(data) });
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { method: 'PUT', headers })).status, 405);
  assert.equal((await read('unknown')).status, 404);
  const readResult = await read();
  assert.equal(readResult.headers.get('cache-control'), 'no-store');
  const initial = await readResult.json();
  assert.equal(initial.series, '旧系列');
  assert.equal(initial.episode, 2);
  assert.equal(initial.source, 'snapshot');
  assert.deepEqual(initial.platforms[0].original, { title: '原稿', body: '正文', tags: '趋势' });
  assert.ok(!JSON.stringify(initial).includes(dir));
  let data = { revision: initial.revision, changes: { series: '新系列', episode: null, notes: '审核完成',
    platforms: { youtube: { title: '本地稿' } } } };
  assert.equal((await post(data, { origin: 'https://not-maitian.example' })).status, 403);
  assert.equal((await post(data, { 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await post(data, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{bad', {}, true)).status, 400);
  assert.equal((await post(' '.repeat(65537), {}, true)).status, 413);
  for (const changes of [{ episode: -1 }, { platforms: { youtube: { url: 'https://example.test/' } } },
    { platforms: { bilibili: { title: '没有该任务' } } }, { state: 'published' }]) {
    assert.equal((await post({ revision: initial.revision, changes })).status, 400);
  }
  const savedResponse = await post(data, { origin: host });
  assert.equal(savedResponse.status, 200);
  assert.equal(savedResponse.headers.get('cache-control'), 'no-store');
  const saved = await savedResponse.json();
  assert.equal(saved.series, '新系列');
  assert.equal(saved.episode, null);
  assert.equal(saved.notes, '审核完成');
  assert.equal(saved.platforms[0].edits.title, '本地稿');
  assert.equal((await post(data)).status, 409);
  assert.equal((await read()).status, 200);
  const stored = await (await read()).json();
  assert.equal(stored.revision, saved.revision);
  assert.deepEqual(JSON.parse(getSnapshot('ep').project), project);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), project);
  assert.equal(getTask('ep', 'youtube').state, 'published');
  const restored = await (await post({ revision: saved.revision, changes: { platforms: { youtube: { title: null } } } })).json();
  assert.deepEqual(restored.platforms[0].edits, {});
  assert.equal(restored.platforms[0].original.title, '原稿');
  const legacy = await (await read('legacy')).json();
  assert.equal(legacy.episode, null);
  assert.equal(legacy.series, '');
  assert.deepEqual(legacy.platforms, []);
  config.web.key = '';
  assert.equal((await read()).status, 401);
  assert.equal((await post(data)).status, 401);
});

test('archive notes markup escapes supplied text and explains its local scope', async () => {
  const html = await readFile(new URL('../src/web/pages.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);[^\n]*$/m, '');
  const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const unsafe = '</textarea><img src=x onerror=alert(1)>"';
  const context = { document: { addEventListener() {} }, addEventListener() {}, esc, unsafe };
  const rendered = vm.runInNewContext(script + '\narchiveNotesHTML({series:unsafe,episode:null,notes:unsafe,platforms:[{name:unsafe,original:{title:unsafe,body:unsafe,tags:unsafe},edits:{}}]})', context);
  assert.ok(!rendered.includes(unsafe));
  assert.match(rendered, /&lt;\/textarea&gt;/);
  assert.match(rendered, /不修改发布工程、发布存档或平台上的作品/);
});
