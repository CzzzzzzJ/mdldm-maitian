import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const read = (file, options) => fs.readFileSync(new URL('../src/web/' + file, import.meta.url), options);
const platforms = ['bilibili', 'douyin', 'xhs', 'channels', 'acfun', 'kuaishou', 'wechat', 'youtube', 'x', 'instagram', 'threads'];

function loadPageScripts(page) {
  const context = vm.createContext({
    document: { querySelector() {}, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    addEventListener() {}, location: { search: '', hash: '' }, URLSearchParams, setInterval() {}, performance,
    matchMedia: () => ({ matches: false }),
  });
  for (const [, file, js] of read(page, 'utf8').matchAll(/<script(?: src="\/static\/([^"]+)")?>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(file ? read(file, 'utf8') : js.replace(/^load\(\);.*$/m, ''), context);
  }
  return (expression) => vm.runInContext(expression, context);
}

test('board and flow pages render local platform art for all platforms and preserve alternate account/site branding', () => {
  for (const page of ['board.html', 'pages.html']) {
    const run = loadPageScripts(page);
    for (const id of platforms) assert.match(run(`logo('${id}')`), new RegExp(`<img src="/static/platform-${id}\\.png" alt="">`));
    assert.equal(run("logo('bilibili@main')"), run("logo('bilibili')"));
    assert.match(run("logo('zsz')"), /<svg/);
    assert.match(run("setSiteLogo(true); logo('zsz')"), /<img src="\/site-logo" alt="">/);
    assert.match(run("setSiteLogo(false); logo('zsz')"), /<svg/);
    assert.equal(run("logo('constructor')"), '');
  }
});

test('bundled platform icons exactly match the official-source asset digest records', () => {
  const records = JSON.parse(read('platform-artwork.json', 'utf8'));
  assert.deepEqual(Object.keys(records).sort(), [...platforms].sort());
  for (const [id, record] of Object.entries(records)) {
    assert.match(record.file, new RegExp(`^platform-${id}\\.png$`));
    assert.match(record.page, /^https:\/\//);
    assert.match(record.artwork, /^https:\/\//);
    const bytes = read(record.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal(records.acfun.appId, 894974941);
  assert.equal(records.kuaishou.appId, 440948110);
});

test('the authenticated web server delivers the unchanged official asset bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-platform-logos-'));
  process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
  process.env.MAITIAN_DB = path.join(dir, 'hub.db');
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ rootPath: dir, web: { port: 0, key: 'fixture' } }));
  const { startWeb } = await import('../src/web.mjs');
  const { db } = await import('../src/db.mjs');
  const server = startWeb();
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/static/platform-acfun.png')).status, 401);
  const headers = { cookie: 'mt_key=fixture' };
  for (const id of ['acfun', 'kuaishou', 'channels']) {
    const file = `platform-${id}.png`;
    const response = await fetch(base + '/static/' + file, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), read(file));
  }
});
