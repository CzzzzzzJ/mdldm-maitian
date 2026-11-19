#!/usr/bin/env node
// 命令行入口：在一个 Ego Lite space 里跑一段任务脚本（async 函数体，返回值即结果）。
//   node src/ego-runner/cli.mjs --space kinso/test/demo [--profile "Profile 5"] [--plugin-dir <dir>]
//        [--params '{"k":1}'] [--timeout-ms 600000] [--finish] [script.js]   # 不给脚本文件就读 stdin
// 结果以一行 JSON 打到 stdout；成功退出码 0，失败 1。
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runEgoTask, finishSpace, DEFAULT_PROFILE, DEFAULT_PLUGIN_DIR } from './index.mjs';

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
if (values.finish && r.reason !== 'bad-space-name' && r.reason !== 'profile-rejected') {
  const { stdout: _o, stderr: _e, ...f } = await finishSpace(values.space, { profileId: values.profile });
  fin = f;
}
const { stdout = "", stderr = "", ...summary } = r;
const ok = r.ok && (!fin || fin.ok);
console.log(JSON.stringify({ ...(r.ok ? summary : { ...summary, output: (stdout + stderr).slice(-2000) }), ...(fin ? { finish: fin } : {}) }));
process.exit(ok ? 0 : 1);
