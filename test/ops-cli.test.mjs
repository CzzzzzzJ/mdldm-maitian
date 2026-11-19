// hub ops 命令行（不需要 Ego Lite）：没有 config.json 时 accounts、tokens 能跑；只写临时目录，不碰仓库的 data/ 和 .env。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HUB = path.join(ROOT, 'src', 'hub.mjs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-cli-'));
  const env = { ...process.env, MAITIAN_CONFIG: path.join(dir, 'no-config.json'), MAITIAN_DB: path.join(dir, 'hub.db'),
    MAITIAN_OPS_DB: path.join(dir, 'ops.db'), MAITIAN_ENV_FILE: path.join(dir, '.env'), MAITIAN_OPS_DIR: path.join(dir, 'ops') };
  const hub = (...args) => spawnSync(process.execPath, [HUB, 'ops', ...args], { env, encoding: 'utf8' });
  return { dir, env, hub };
}

describe('hub ops 命令行（没有 config.json）', () => {
  test('accounts import / list / set-uid / set-cap', () => {
    const { dir, hub } = sandbox();
    let r = hub('accounts', 'import');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /新增 10/);
    r = hub('accounts', 'import');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /新增 0/);
    r = hub('accounts', 'set-uid', 'YouTube', 'UCxyz');
    assert.equal(r.status, 0, r.stderr);
    r = hub('accounts', 'set-cap', 'Bili:478358005', 'readWorks', 'true');
    assert.equal(r.status, 0, r.stderr);
    r = hub('accounts', 'list', '--json');
    assert.equal(r.status, 0, r.stderr);
    const list = JSON.parse(r.stdout);
    assert.equal(list.length, 10);
    assert.equal(list.find((a) => a.platformCode === 'YouTube').spaceName, 'kinso/YouTube/UCxyz');
    assert.equal(list.find((a) => a.id === 'Bili:478358005').capabilities.readWorks, true);
    assert.ok(fs.existsSync(path.join(dir, 'ops.db')));
    assert.ok(!fs.existsSync(path.join(dir, 'hub.db')), 'hub ops 不应加载麦田原库');
    assert.notEqual(hub('accounts', 'set-cap', 'Bili:478358005', 'fly', 'true').status, 0);
  });

  test('tokens init：生成、600、重复不覆盖、输出不含值', () => {
    const { dir, hub } = sandbox();
    const r1 = hub('tokens', 'init');
    assert.equal(r1.status, 0, r1.stderr);
    const envFile = path.join(dir, '.env');
    const text = fs.readFileSync(envFile, 'utf8');
    const values = [...text.matchAll(/^MAITIAN_\w+_TOKEN=(\w+)$/gm)].map((m) => m[1]);
    assert.equal(values.length, 3);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    const r2 = hub('tokens', 'init');
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(fs.readFileSync(envFile, 'utf8'), text);
    for (const v of values) for (const r of [r1, r2]) { assert.ok(!r.stdout.includes(v)); assert.ok(!r.stderr.includes(v)); }
  });

  test('不认识的子命令退出码 1，help 退出码 0', () => {
    const { hub } = sandbox();
    assert.equal(hub('nope').status, 1);
    const h = hub('help');
    assert.equal(h.status, 0);
    assert.match(h.stdout, /tokens init/);
  });
});

describe('默认飞书提醒（defaultNotify）', () => {
  const LOGIN = pathToFileURL(path.join(ROOT, 'src', 'ops', 'login.mjs')).href;
  const run = (env) => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `const { defaultNotify } = await import(${JSON.stringify(LOGIN)}); console.error('RET=' + await defaultNotify('❌ 抖音账号掉线 | Douyin:1\\n详情'));`],
    { env: { ...process.env, ...env } });

  test('发出时 stdout 不出现任何内容（--json 的 stdout 保持合法 JSON），返回 true', async () => {
    const got = [];
    const server = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push(b); res.end('{"code":0}'); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-notify-'));
      const cfg = path.join(dir, 'config.json');
      fs.writeFileSync(cfg, JSON.stringify({ feishuWebhook: `http://127.0.0.1:${server.address().port}/hook`, rootPath: dir }));
      const { stdout, stderr } = await run({ MAITIAN_CONFIG: cfg });
      assert.equal(stdout, '');
      assert.match(stderr, /RET=true/);
      assert.equal(got.length, 1);
    } finally { server.close(); }
  });

  test('没有 config.json、或没配 webhook：没发，返回 false，stdout 为空', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-notify-'));
    let r = await run({ MAITIAN_CONFIG: path.join(dir, 'none.json') });
    assert.equal(r.stdout, ''); assert.match(r.stderr, /RET=false/);
    const cfg = path.join(dir, 'config.json');
    fs.writeFileSync(cfg, JSON.stringify({ rootPath: dir }));
    r = await run({ MAITIAN_CONFIG: cfg });
    assert.equal(r.stdout, ''); assert.match(r.stderr, /RET=false/);
  });
});
