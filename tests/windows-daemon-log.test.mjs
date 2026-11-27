import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-daemon-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preloader = path.join(root, 'scripts', 'windows', 'daemon-log.mjs');
  fs.mkdirSync(path.dirname(preloader), { recursive: true });
  fs.copyFileSync(new URL('../scripts/windows/daemon-log.mjs', import.meta.url), preloader);

  const run = (source) => spawnSync(process.execPath, ['--import', './scripts/windows/daemon-log.mjs', '-e', source], {
    cwd: root, encoding: 'utf8', timeout: 5000,
  });
  return { root, run, readLog: () => fs.readFileSync(path.join(root, 'data', 'daemon.log'), 'utf8') };
}

test('Windows daemon logs append output and crashes without changing the exit code', (t) => {
  const { run, readLog } = fixture(t);
  const first = run(`
    console.log('ready http://localhost:8787/?key=fixture-secret');
    process.stderr.write(Buffer.from('错误输出\\n'));
    process.exit(23);
  `);
  assert.equal(first.status, 23, first.error?.message || first.stderr);
  assert.match(first.stdout, /ready/);
  assert.match(first.stderr, /错误输出/);

  const crashed = run("throw new Error('fixture crash')");
  assert.equal(crashed.status, 1, crashed.error?.message || crashed.stderr);
  const log = readLog();
  assert.match(log, /ready http:\/\/localhost:8787\/\?key=\[已隐藏\]/);
  assert.doesNotMatch(log, /fixture-secret/);
  assert.match(log, /错误输出[\s\S]*退出（状态 23）[\s\S]*fixture crash[\s\S]*退出（状态 1）/);
});

test('Windows daemon starts even if its log directory cannot be created', (t) => {
  const { root, run } = fixture(t);
  fs.writeFileSync(path.join(root, 'data'), 'a file blocks the directory');

  const result = run("console.log('started'); console.error('still running');");
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.match(result.stdout, /started/);
  assert.match(result.stderr, /still running/);
  assert.equal(result.stderr.match(/麦田运行日志写入失败/g)?.length, 1);
});

test('Windows daemon preserves output and exit status when log writes fail and then recover', (t) => {
  const { run, readLog } = fixture(t);
  const result = run(`
    const fs = require('node:fs');
    const append = fs.appendFileSync;
    fs.appendFileSync = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    console.log('normal stdout while disk is full');
    console.error('normal stderr while disk is full');
    fs.appendFileSync = append;
    console.log('logging recovered');
    process.exit(23);
  `);
  assert.equal(result.status, 23, result.error?.message || result.stderr);
  assert.match(result.stdout, /normal stdout while disk is full/);
  assert.match(result.stderr, /normal stderr while disk is full/);
  assert.equal(result.stderr.match(/麦田运行日志写入失败/g)?.length, 1);
  assert.match(readLog(), /logging recovered[\s\S]*退出（状态 23）/);
});
