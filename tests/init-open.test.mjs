import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('安装向导按系统打开大屏，Windows 转义 cmd 特殊字符', () => {
  const s = fs.readFileSync(new URL('../src/init.mjs', import.meta.url), 'utf8');
  const start = s.indexOf('function boardLaunch(');
  const end = s.indexOf('function openBoard(');
  assert.ok(start >= 0 && end > start, 'boardLaunch 应在 openBoard 前面');
  // 当前上下文里跑，对象原型才能和断言里的字面量对上
  const boardLaunch = vm.runInThisContext(`${s.slice(start, end)}\nboardLaunch`);
  const url = 'http://localhost:8787/?key=a&b%c|d<e>f^g';
  assert.deepEqual(boardLaunch(url, 'win32'), {
    file: 'cmd.exe',
    args: ['/c', 'start', '""', 'http://localhost:8787/?key=a^&b^%c^|d^<e^>f^^g'],
    opts: { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true },
  });
  assert.deepEqual(boardLaunch('http://localhost:8787/?key=abc', 'darwin'), {
    file: 'open',
    args: ['http://localhost:8787/?key=abc'],
    opts: { stdio: 'ignore' },
  });
  assert.equal(boardLaunch('http://localhost:8787/?key=abc', 'linux'), null);
});
