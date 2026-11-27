import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const waitFor = async (predicate) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('timed out waiting for child');
};

function world(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-publish-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'hub.db');
  const env = { ...process.env, MAITIAN_DB: dbPath, NODE_NO_WARNINGS: '1' };
  const children = [];
  t.after(() => { for (const p of children) if (p.exitCode === null) p.kill('SIGKILL'); });
  const node = (code, extra = {}) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: { ...env, ...extra } });
    children.push(child);
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
    return { child, done };
  };
  return { dir, dbPath, node };
}

test('two processes cannot hold the same episode, and a different episode can', async (t) => {
  const w = world(t);
  const ready = path.join(w.dir, 'ready'), release = path.join(w.dir, 'release');
  const first = w.node(`
    import fs from 'node:fs';
    const { holdPublishLock } = await import('./src/publish-lock.mjs');
    const h = holdPublishLock(process.env.EP);
    fs.writeFileSync(process.env.READY, h.owner);
    while (!fs.existsSync(process.env.RELEASE)) await new Promise((r) => setTimeout(r, 15));
    h.release();
  `, { EP: 'ep', READY: ready, RELEASE: release });
  await waitFor(() => fs.existsSync(ready));
  const blocked = await w.node(`
    const { acquirePublishLock } = await import('./src/publish-lock.mjs');
    try { acquirePublishLock('ep'); console.log('GOT'); }
    catch (e) { console.log('BLOCK ' + e.message); process.exitCode = 2; }
  `).done;
  assert.equal(blocked.code, 2);
  assert.match(blocked.out, /BLOCK 这一期正在别的进程里发布/);
  const other = await w.node(`
    const { acquirePublishLock, releasePublishLock } = await import('./src/publish-lock.mjs');
    const lock = acquirePublishLock('other');
    releasePublishLock('other', lock.owner);
    console.log('OTHER');
  `).done;
  assert.equal(other.code, 0, other.err);
  assert.match(other.out, /OTHER/);
  fs.writeFileSync(release, '1');
  assert.equal((await first.done).code, 0);
  const again = await w.node(`
    const { acquirePublishLock, releasePublishLock } = await import('./src/publish-lock.mjs');
    const lock = acquirePublishLock('ep');
    releasePublishLock('ep', lock.owner);
    console.log('AGAIN');
  `).done;
  assert.match(again.out, /AGAIN/);
});

test('an expired lease can be taken over and the old owner cannot clear it', async (t) => {
  const w = world(t);
  const ready = path.join(w.dir, 'ready'), go = path.join(w.dir, 'go'), result = path.join(w.dir, 'result');
  const first = w.node(`
    import fs from 'node:fs';
    const { acquirePublishLock, renewPublishLock, releasePublishLock } = await import('./src/publish-lock.mjs');
    const lock = acquirePublishLock(process.env.EP, { ttl: 60000 });
    fs.writeFileSync(process.env.READY, lock.owner);
    while (!fs.existsSync(process.env.GO)) await new Promise((r) => setTimeout(r, 15));
    let msg = 'renewed';
    try { renewPublishLock(process.env.EP, lock.owner); }
    catch (e) { msg = 'lost ' + e.message; }
    releasePublishLock(process.env.EP, lock.owner);
    fs.writeFileSync(process.env.RESULT, msg);
  `, { EP: 'ep', READY: ready, GO: go, RESULT: result });
  await waitFor(() => fs.existsSync(ready));
  const db = new DatabaseSync(w.dbPath);
  const key = 'publishLock:ep';
  const cur = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key).value);
  cur.until = Date.now() - 1000;
  db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(cur), key);
  db.close();
  const second = await w.node(`
    const { acquirePublishLock } = await import('./src/publish-lock.mjs');
    const lock = acquirePublishLock('ep', { ttl: 60000 });
    console.log(lock.owner);
  `).done;
  assert.equal(second.code, 0, second.err);
  const owner = second.out.trim();
  assert.notEqual(owner, fs.readFileSync(ready, 'utf8'));
  fs.writeFileSync(go, '1');
  assert.equal((await first.done).code, 0);
  assert.match(fs.readFileSync(result, 'utf8'), /lost 发布锁已过期或被接替/);
  const after = new DatabaseSync(w.dbPath);
  assert.equal(JSON.parse(after.prepare('SELECT value FROM meta WHERE key=?').get(key).value).owner, owner);
  after.close();
});

test('a killed holder is recovered without waiting for the lease', async (t) => {
  const w = world(t);
  const ready = path.join(w.dir, 'ready');
  const first = w.node(`
    import fs from 'node:fs';
    const { holdPublishLock } = await import('./src/publish-lock.mjs');
    const h = holdPublishLock(process.env.EP, { ttl: 600000 });
    fs.writeFileSync(process.env.READY, String(h.owner));
    await new Promise(() => {});
  `, { EP: 'ep', READY: ready });
  await waitFor(() => fs.existsSync(ready));
  first.child.kill('SIGKILL');
  const dead = await first.done;
  assert.notEqual(dead.code, 0);
  const second = await w.node(`
    const { acquirePublishLock, releasePublishLock } = await import('./src/publish-lock.mjs');
    let lock;
    for (let i = 0; i < 50; i++) {
      try { lock = acquirePublishLock('ep'); break; }
      catch (e) {
        if (!/locked|busy/i.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    if (!lock) throw new Error('lock stayed busy');
    console.log('recovered');
    releasePublishLock('ep', lock.owner);
  `).done;
  assert.equal(second.code, 0, second.err + second.out);
  assert.match(second.out, /recovered/);
});
