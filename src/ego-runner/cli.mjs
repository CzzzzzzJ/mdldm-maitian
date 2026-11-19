#!/usr/bin/env node
// 命令行入口：在一个 Ego Lite space 里跑一段任务脚本（async 函数体，返回值即结果）。
//   node src/ego-runner/cli.mjs --space kinso/test/demo [--profile "Profile 5"] [--plugin-dir <dir>]
//        [--params '{"k":1}'] [--timeout-ms 600000] [--finish] [script.js]   # 不给脚本文件就读 stdin
// 结果以一行 JSON 打到 stdout。退出码：0 成功；3 profile 不存在（profile-needed）；4 space 正由负责人手动操作
// （user-controlled）；5 space 锁被另一个任务进程持有（busy）；其余失败 1。--finish 只在任务真的跑过时才关 space。
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runEgoTask, finishSpace, exitCodeOf, DEFAULT_PROFILE, DEFAULT_PLUGIN_DIR } from './index.mjs';

// 这些失败说明任务没碰到 space（或 space 不归我们），不能再去关它
const NO_FINISH = new Set(['bad-space-name', 'profile-rejected', 'profile-needed', 'user-controlled', 'busy']);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    space: { type: 'string' },
    profile: { type: 'string', default: DEFAULT_PROFILE },
    'plugin-dir': { type: 'string', default: process.env.MAITIAN_PLUGIN_DIR || DEFAULT_PLUGIN_DIR },
    params: { type: 'string', default: '{}' },
    'timeout-ms': { type: 'string' },
    finish: { type: 'boolean', default: false },
  },
});

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const script = positionals[0] ? await readFile(positionals[0], 'utf8') : await readStdin();
const r = await runEgoTask({
  space: values.space,
  profileId: values.profile,
  pluginDir: values['plugin-dir'],
  params: JSON.parse(values.params),
  script,
  ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}),
});
let fin = null;
if (values.finish && !NO_FINISH.has(r.reason)) {
  const { stdout: _o, stderr: _e, ...f } = await finishSpace(values.space, { profileId: values.profile });
  fin = f;
}
const { stdout = "", stderr = "", ...summary } = r;
console.log(JSON.stringify({ ...(r.ok ? summary : { ...summary, output: (stdout + stderr).slice(-2000) }), ...(fin ? { finish: fin } : {}) }));
process.exit(r.ok && fin && !fin.ok ? 1 : exitCodeOf(r));
