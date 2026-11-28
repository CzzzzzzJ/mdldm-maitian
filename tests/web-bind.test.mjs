import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'plain-key-should-not-leak';

function boot(host) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-web-bind-'));
  const cfg = path.join(dir, 'config.json');
  const web = { port: 0, key: KEY };
  if (host) web.host = host;
  fs.writeFileSync(cfg, JSON.stringify({ rootPath: dir, web }));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { once } from 'node:events';
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    const { startWeb } = await import('./src/web.mjs');
    const srv = startWeb();
    if (!srv.listening) await once(srv, 'listening');
    const addr = srv.address();
    const res = await fetch('http://127.0.0.1:' + addr.port + '/');
    const body = await res.text();
    process.stderr.write('RESULT ' + JSON.stringify({ address: addr.address, port: addr.port, status: res.status, body, log: lines.join('\\n') }) + '\\n');
    await new Promise((resolve) => srv.close(resolve));
  `], {
    cwd: root,
    env: { ...process.env, MAITIAN_CONFIG: cfg, MAITIAN_DB: path.join(dir, 'hub.db'), NODE_NO_WARNINGS: '1' },
    encoding: 'utf8',
    timeout: 15000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const line = (result.stderr || '').split('\n').filter((l) => l.startsWith('RESULT ')).pop();
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, line: line && JSON.parse(line.slice('RESULT '.length)) };
}

test('dashboard binds loopback by default and does not log the key', () => {
  const r = boot();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.line.address, '127.0.0.1');
  assert.equal(r.line.status, 401);
  assert.equal(r.line.log.includes(KEY), false);
  assert.equal(r.line.body.includes(KEY), false);
  assert.match(r.line.log, /127\.0\.0\.1/);
  assert.match(r.line.log, /只在本机/);
});

test('lan access is explicit via web.host', () => {
  const r = boot('0.0.0.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.line.address, '0.0.0.0');
  assert.equal(r.line.log.includes(KEY), false);
  assert.match(r.line.log, /0\.0\.0\.0/);
});
