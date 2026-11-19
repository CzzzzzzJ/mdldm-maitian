// hub.mjs 的第一个 import：`hub ops ...` 在这里同步转给 src/ops/cli.mjs 并退出，
// 不让 hub.mjs 后面的 import（feishu.mjs 没有 config.json 会 process.exit，db.mjs 会建 data/hub.db，还有浏览器驱动）跑起来。
// ESM 按 import 顺序求值，这里只能用同步调用，所以起一个子进程。
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.argv[2] === 'ops') {
  const cli = path.join(import.meta.dirname, 'cli.mjs');
  const r = spawnSync(process.execPath, [cli, ...process.argv.slice(3)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
