import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const waitFor = async (predicate) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('timed out waiting for publish');
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const calls = path.join(dir, 'calls.jsonl');
  const release = path.join(dir, 'release');
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    rootPath: dir,
    batches: [['bilibili', 'douyin'], ['xhs', 'channels'], ['zsz', 'x'], ['youtube'], ['instagram', 'threads']],
    auto: ['zsz', 'x', 'youtube', 'instagram', 'threads'],
    manual: ['bilibili', 'douyin', 'xhs', 'channels'],
    web: { port: 0, key: 'secret-key' },
    driver: 'direct',
    site: { name: '知识站', enabled: true, base: 'https://example.com' },
  }));
  fs.writeFileSync(path.join(dir, 'src/validate.mjs'), 'export async function validateProject(){ return { ok:true, errors:[], warnings:[], text:"ok" }; }\n');
  fs.writeFileSync(path.join(dir, 'src/board.mjs'), 'export async function boardSync(){ return null; } export async function syncSalesIfDue(){ return null; } export async function syncScheduledSales(){ return null; }\n');
  fs.writeFileSync(path.join(dir, 'src/driver.mjs'), `
    import fs from 'node:fs';
    const call = (name, args) => fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ name, args }) + '\\n');
    export const mode = 'direct';
    export async function ensure() { call('ensure', []); }
    export async function close() {}
    export async function busy() { return false; }
    export async function sleep() {}
    export async function withTab(url) { call('withTab', [String(url)]); if (String(url).includes('scheduled_content')) throw new Error('scheduled down'); throw new Error('profile opened'); }
    export async function evaluate() { throw new Error('browser'); }
    export async function click() { throw new Error('browser'); }
    export async function adoptTabs() { call('adoptTabs', []); return []; }
    export async function screenshot() { return Buffer.alloc(0); }
    export async function checkLogin(ids) { call('checkLogin', ids); return Object.fromEntries(ids.map((id) => [id, { ok: true }])); }
    export async function links() { return {}; }
    export async function openForLogin() {}
    export async function runBatch(project, batch) {
      call('runBatch', batch);
      if (process.env.TEST_WAIT) while (!fs.existsSync(process.env.TEST_RELEASE)) await new Promise((r) => setTimeout(r, 15));
      return {};
    }
  `);
  fs.writeFileSync(path.join(dir, 'src/checks.mjs'), `
    const spec = JSON.parse(process.env.TEST_CHECKS || '{}');
    function one(name, empty) {
      const s = spec[name];
      if (s === 'throw') throw new Error(name + ' down');
      if (s === 'null') return null;
      if (s && typeof s === 'object') return s;
      return empty;
    }
    export const xExisting = async () => one('x', null);
    export const ytRows = async () => one('youtube', []);
    export const igExisting = async () => one('instagram', null);
    export const threadsExisting = async () => one('threads', null);
    export const zszCourses = async () => one('zsz', []);
    export const douyinTopics = async () => [];
    export const xSubmit = async () => ({ ok: false, reason: 'no' });
    export const ytSubmit = async () => ({ ok: false, reason: 'no' });
    export const igSubmit = async () => ({ ok: false, reason: 'no' });
    export const threadsSubmit = async () => ({ ok: false, reason: 'no' });
  `);
  const env = { ...process.env, MAITIAN_CONFIG: config, MAITIAN_DB: path.join(dir, 'hub.db'), TEST_CALLS: calls, TEST_RELEASE: release, HUB_NO_WEB: '1', NODE_NO_WARNINGS: '1' };
  const children = [];
  t.after(() => { for (const p of children) if (p.exitCode === null) p.kill('SIGKILL'); });
  const start = (args, extra = {}) => {
    const child = spawn(process.execPath, ['src/hub.mjs', ...args], { cwd: dir, env: { ...env, ...extra } });
    children.push(child);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
    return { child, done };
  };
  return {
    dir, env, release, start,
    calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
    tasks: () => { const db = new DatabaseSync(env.MAITIAN_DB); try { return db.prepare('SELECT platform, state, detail FROM tasks ORDER BY platform').all(); } finally { db.close(); } },
  };
}

function project(f, platforms, id = 'ep1') {
  const dir = path.join(f.dir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'publish.json'), JSON.stringify({ id, episode: 1, name: '测试期', platforms }));
  return dir;
}

const PLATFORMS = {
  bilibili: { title: 'b' }, x: { text: 'hello' }, youtube: { title: 'yt' },
  instagram: { caption: 'ig' }, threads: { text: 'th' }, zsz: { title: '课' },
};
const batchesOf = (f) => f.calls().filter((c) => c.name === 'runBatch').map((c) => c.args);

test('a failed online duplicate check holds the platform instead of uploading', async (t) => {
  const f = fixture(t);
  const dir = project(f, PLATFORMS);
  const checks = JSON.stringify({ x: 'throw', youtube: 'null', instagram: 'throw', threads: 'throw', zsz: 'throw' });
  const run = await f.start(['run', dir], { TEST_CHECKS: checks }).done;
  assert.equal(run.code, 0, run.err + run.out);
  assert.deepEqual(batchesOf(f), [['bilibili']]);
  const tasks = Object.fromEntries(f.tasks().map((row) => [row.platform, row]));
  for (const id of ['x', 'instagram', 'threads', 'zsz']) {
    assert.equal(tasks[id].state, 'awaiting_user');
    assert.match(tasks[id].detail, /查重失败，没有上传/);
    assert.match(tasks[id].detail, /--force/);
  }
  assert.match(tasks.youtube.detail, /Studio 列表没读到/);
  assert.equal(tasks.bilibili.state, 'pending');
  assert.equal(run.out.includes('secret-key'), false);
});

test('a clean duplicate check still uploads, and a real hit does not', async (t) => {
  const f = fixture(t);
  const clean = project(f, { x: { text: 'hello' }, youtube: { title: 'yt' } }, 'clean');
  const ok = await f.start(['run', clean]).done;
  assert.equal(ok.code, 0, ok.err + ok.out);
  assert.deepEqual(batchesOf(f), [['x'], ['youtube']]);
  const found = project(f, { x: { text: 'hello' } }, 'found');
  const hit = await f.start(['run', found], { TEST_CHECKS: JSON.stringify({ x: { state: 'published', detail: '已有', url: 'https://x.com/i' } }) }).done;
  assert.equal(hit.code, 0, hit.err);
  assert.equal(batchesOf(f).some((batch) => batch.includes('x') && batch.length === 1 && f.calls().length > 2), true);
  const tasks = f.tasks().filter((row) => row.platform === 'x');
  assert.equal(tasks.find((row) => row.detail === '已有').state, 'published');
  assert.equal(batchesOf(f).flat().filter((id) => id === 'x').length, 1);
});

test('a held duplicate failure is not uploaded again unless --force and the check succeeds', async (t) => {
  const f = fixture(t);
  const dir = project(f, { x: { text: 'hello' } });
  const first = await f.start(['run', dir], { TEST_CHECKS: JSON.stringify({ x: 'throw' }) }).done;
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(batchesOf(f), []);
  const again = await f.start(['run', dir], { TEST_CHECKS: '{}' }).done;
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /已到位、跳过/);
  assert.deepEqual(batchesOf(f), []);
  const forced = await f.start(['run', dir, '--force'], { TEST_CHECKS: '{}' }).done;
  assert.equal(forced.code, 0, forced.err);
  assert.deepEqual(batchesOf(f), [['x']]);
});

test('hub run and hub submit share one cross-process lock and a crash lets the next run upload', async (t) => {
  const f = fixture(t);
  const dir = project(f, { x: { text: 'hello' }, threads: { text: 'th' } });
  const first = f.start(['run', dir], { TEST_WAIT: '1', TEST_CHECKS: '{}' });
  await waitFor(() => batchesOf(f).length === 1);
  const second = await f.start(['run', dir], { TEST_CHECKS: '{}' }).done;
  assert.equal(second.code, 1, second.out);
  assert.match(second.err, /这一期正在别的进程里发布/);
  assert.equal(batchesOf(f).length, 1);
  const submit = await f.start(['submit', 'ep1', 'threads'], { TEST_CHECKS: '{}' }).done;
  assert.equal(submit.code, 1, submit.out);
  assert.match(submit.err, /这一期正在别的进程里发布/);
  assert.equal(f.calls().some((c) => c.name === 'adoptTabs'), false);
  first.child.kill('SIGKILL');
  await first.done;
  const third = await f.start(['run', dir], { TEST_CHECKS: '{}' }).done;
  assert.equal(third.code, 0, third.err + third.out);
  assert.ok(batchesOf(f).length >= 2);
});

test('hub submit stops when the duplicate check fails', async (t) => {
  const f = fixture(t);
  const dir = project(f, { x: { text: 'hello' } });
  const seeded = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { upsertEpisode, setTask, db } = await import('./src/db.mjs');
    upsertEpisode({ id: 'ep1', episode: 1, name: '测试期', dir: ${JSON.stringify(dir)}, schedule: null });
    setTask('ep1', 'x', 'filled', '已填好');
    db.close();
  `], { cwd: f.dir, env: f.env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  const submit = await f.start(['submit', 'ep1', 'x'], { TEST_CHECKS: JSON.stringify({ x: 'throw' }) }).done;
  assert.equal(submit.code, 1, submit.out);
  assert.match(submit.err, /查重失败/);
  const task = f.tasks().find((row) => row.platform === 'x');
  assert.equal(task.state, 'awaiting_user');
  assert.match(task.detail, /没有提交/);
  assert.equal(f.calls().some((c) => c.name === 'adoptTabs'), false);
});

test('instagram duplicate check does not treat a scheduled-page error as no duplicate', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-ig-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ web: { key: 'k' } }));
  fs.writeFileSync(path.join(dir, 'src/driver.mjs'), `
    export async function evaluate() { throw new Error('browser'); }
    export async function sleep() {}
    export async function click() { throw new Error('browser'); }
    export async function withTab(url) { if (String(url).includes('scheduled_content')) throw new Error('scheduled down'); throw new Error('profile opened'); }
  `);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { igExisting } from './src/checks.mjs';
    try { await igExisting('标题'); console.log('NO'); }
    catch (e) { console.log('THREW ' + e.message); }
  `], { cwd: dir, env: { ...process.env, MAITIAN_CONFIG: path.join(dir, 'config.json'), MAITIAN_DB: path.join(dir, 'hub.db'), NODE_NO_WARNINGS: '1' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /THREW scheduled down/);
  assert.equal(result.stdout.includes('profile opened'), false);
});
