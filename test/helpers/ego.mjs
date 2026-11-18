// 测试共用：Ego Lite 在不在、临时 space 名、本地测试页地址。
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runEgoScript } from '../../src/ego-runner/index.mjs';

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const fixtureUrl = (name) => pathToFileURL(FIXTURE_DIR + name).href;

export const tempSpaceName = (tag = 't') => `kinso/test/${tag}-${randomBytes(4).toString('hex')}`;

// Ego Lite 没装、没开或没有 Profile 5 时返回原因，测试据此 skip（不假装通过）
export async function egoUnavailableReason() {
  const r = await runEgoScript('console.log("@@RESULT " + JSON.stringify((await profiles()).some((p) => p.id === "Profile 5")))', { timeoutMs: 30_000 });
  if (!r.ok) return `Ego Lite 不可用：${r.reason} ${r.error}`;
  if (r.result !== true) return 'Ego Lite 里没有 Profile 5';
  return null;
}

export const EGO_SKIP = await egoUnavailableReason();
if (EGO_SKIP) console.log(`# SKIP Ego Lite 行为测试：${EGO_SKIP}`);
