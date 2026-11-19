#!/usr/bin/env node
// 测试用：等到指定时刻再取一次锁，把结果打成一行 JSON。用来让几个进程同时抢同一把锁。
//   node lock-worker.mjs <锁文件> <开始时刻 epoch ms> <staleMs>
import { tryLock } from '../../src/ego-runner/locks.mjs';

const [path, at, staleMs] = process.argv.slice(2);
while (Date.now() < Number(at)) { /* 忙等到同一时刻，比 setTimeout 对得更齐 */ }
const r = tryLock(path, { staleMs: Number(staleMs) });
console.log(JSON.stringify({ ok: r.ok, pid: process.pid }));
