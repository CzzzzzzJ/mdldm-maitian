// 写入口令：engage（回复、私信等互动）、publish（发布）、manage（账号管理）。存在麦田仓库根目录 .env（权限 600）。
// 口令值绝不打印、不写日志、不进错误信息。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { envPath as defaultEnvPath } from './paths.mjs';

export const TOKEN_SCOPES = { engage: 'MAITIAN_ENGAGE_TOKEN', publish: 'MAITIAN_PUBLISH_TOKEN', manage: 'MAITIAN_MANAGE_TOKEN' };
export const TOKEN_NAMES = Object.values(TOKEN_SCOPES);

const opensslHex32 = () => execFileSync('openssl', ['rand', '-hex', '32'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function readEnv(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`读不了 ${file}：${e.code}`); }
  const vars = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { text, vars };
}

/** 生成缺的口令写进 .env（已有的不动），文件权限设成 600。返回给人看的说明（不含口令值）。 */
export function initTokens(file, { generate = opensslHex32 } = {}) {
  const { text, vars } = readEnv(file);
  const lines = [], report = [];
  for (const name of TOKEN_NAMES) {
    if (vars[name]) { report.push(`${name}：已存在，没动`); continue; }
    const v = generate();
    if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`生成 ${name} 失败：openssl rand -hex 32 的输出不是 64 位十六进制`);
    lines.push(`${name}=${v}`);
    report.push(`${name}：已生成`);
  }
  if (lines.length) {
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, text + prefix + lines.join('\n') + '\n', { mode: 0o600 });
  } else if (!fs.existsSync(file)) fs.writeFileSync(file, '', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return `${report.join('\n')}\n口令文件：${file}（权限 600）`;
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** 校验写入口令：scope 是 engage / publish / manage；.env 里没有这个口令、给的是空的，一律拒绝。常数时间比较。 */
export function checkToken(scope, provided, { envPath = defaultEnvPath() } = {}) {
  const name = TOKEN_SCOPES[scope];
  if (!name || !envPath) return false;
  let expected;
  try { expected = readEnv(envPath).vars[name]; } catch { return false; }
  if (!expected || typeof provided !== 'string' || !provided) return false;
  return timingSafeEqual(digest(expected), digest(provided));
}
