// hub ops 命令行（不需要 Ego Lite）：没有 config.json 时 accounts、tokens 能跑；只写临时目录，不碰仓库的 data/ 和 .env。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
