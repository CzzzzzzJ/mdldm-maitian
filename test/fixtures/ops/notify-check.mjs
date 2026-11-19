// 测试用：在子进程里跑一次 checkLogins（默认飞书通知，假 runner 返回掉线），把抖音账号的 alertSentAt 写到 stderr。
// 用法：node notify-check.mjs <ops.db 路径> <seed 路径> <时间毫秒>（MAITIAN_CONFIG 由调用方设置）
import { openOpsDb } from '../../../src/ops/db.mjs';
import { importAccounts, getAccount } from '../../../src/ops/accounts.mjs';
import { checkLogins } from '../../../src/ops/login.mjs';

const [dbPath, seed, at] = process.argv.slice(2);
const db = openOpsDb(dbPath);
importAccounts(db, seed);
const runTask = async () => ({ ok: true, result: { state: 'out', evidence: 'status_code=8', uidSeen: null } });
await checkLogins(db, { platform: 'Douyin', runTask, now: () => Number(at) });
console.error(`@@ALERT ${JSON.stringify(getAccount(db, 'Douyin:106707338905').alertSentAt)}`);
