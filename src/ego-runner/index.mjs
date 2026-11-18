// 短进程 runner：每个任务起一个 ego-browser nodejs 子进程，脚本从 stdin 传入，
// 子进程最后一行打印 `@@RESULT <json>`，这里解析成结果。没有这一行、JSON 坏、退出码非零都是失败。
// 实测：ego-browser CLI 把脚本的 console.log 全写到它自己的 stderr（stdout 为空），所以解析 stdout+stderr。
//
// ego-browser nodejs 的脚本不继承环境变量、不在本进程的工作目录里跑，
// 所以参数以 JSON 字面量写进脚本前言，模块用 file:// 绝对地址加载（已实测可以 import 本地 ESM）。
import { spawn } from 'node:child_process';
import { FORBIDDEN_PROFILE } from './space.mjs';

export const DEFAULT_PROFILE = 'Profile 5';
export const DEFAULT_PLUGIN_DIR = '/Users/kinso/code/github/kinsolee/mdldm-maitian-publisher';
export const RESULT_PREFIX = '@@RESULT ';
const SPACE_NAME = /^kinso\/[a-z0-9_-]+\/[^/\s]+$/i;
const EGO_NOTICE = /^\[ego-browser:/;

const SHIM_URL = new URL('../ego-shim.mjs', import.meta.url).href;
const SPACE_URL = new URL('./space.mjs', import.meta.url).href;

/** 从子进程输出里取结果：最后一个非空、非 Ego 提示的行必须是 `@@RESULT <json>`，且退出码为 0。 */
export function parseResult(output, code) {
  if (code !== 0) return { ok: false, reason: 'exit-code', code, error: `ego-browser nodejs 退出码 ${code}` };
  const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l && !EGO_NOTICE.test(l));
  const last = lines.at(-1) ?? '';
  if (!last.startsWith(RESULT_PREFIX)) return { ok: false, reason: 'no-result', error: '最后一行不是 @@RESULT' };
  try { return { ok: true, result: JSON.parse(last.slice(RESULT_PREFIX.length)) }; }
  catch (e) { return { ok: false, reason: 'bad-json', error: `@@RESULT 不是合法 JSON：${e.message}` }; }
}

/** 原样跑一段 ego-browser nodejs 脚本（不加前言），返回 { ok, result | reason, error, code, stdout, stderr }。 */
export function runEgoScript(source, { egoBin = 'ego-browser', timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', settled = false, timedOut = false;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ stdout, stderr, ...r }); } };
    const child = spawn(egoBin, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => done({ ok: false, reason: 'spawn-failed', error: e.message }));
    child.on('close', (code, signal) => {
      if (timedOut) return done({ ok: false, reason: 'timeout', error: `超过 ${timeoutMs}ms 被停掉`, code });
      done({ ...parseResult(stdout + stderr, code ?? (signal ? 128 : 1)), code: code ?? null, signal });
    });
    child.stdin.on('error', () => { /* 子进程没起来时写 stdin 会报 EPIPE，结果由 error/close 给出 */ });
    child.stdin.end(source);
  });
}

/** 把任务脚本包上前言：取用 space、装好 chrome 垫片、提供 params / loadPlugin，最后把返回值打成 @@RESULT。 */
export function buildTaskSource({ space, profileId, params, pluginDir, script }) {
  const ctx = { space, profileId, params, pluginDir, shimUrl: SHIM_URL, spaceUrl: SPACE_URL };
  return `const __ctx = ${JSON.stringify(ctx)};
const { openSpace } = await import(__ctx.spaceUrl);
const { createEgoChrome } = await import(__ctx.shimUrl);
const task = await openSpace({ listTaskSpaces, taskSpace, claimTaskSpace }, { name: __ctx.space, profileId: __ctx.profileId });
const shim = createEgoChrome(task);
globalThis.chrome = shim.chrome;
const { chrome, recoverTabs } = shim;
const params = __ctx.params;
const pluginDir = __ctx.pluginDir;
const loadPlugin = (rel) => import(new URL(rel, "file://" + pluginDir.replace(/\\/?$/, "/")).href);
const __value = await (async () => {
${script}
})();
if (__value !== undefined) console.log(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(__value));
`;
}

/**
 * 在一个 space 里跑一段任务脚本。脚本是 async 函数体，可用 task、chrome、recoverTabs、params、pluginDir、loadPlugin；
 * 返回值即结果（返回 undefined 视为没有结果、算失败）。
 * @returns {Promise<{ok: true, result: any} | {ok: false, reason: string, error: string}>}
 */
export async function runEgoTask({ space, script, profileId = DEFAULT_PROFILE, params = {}, pluginDir = DEFAULT_PLUGIN_DIR, egoBin, timeoutMs } = {}) {
  if (profileId === FORBIDDEN_PROFILE) return { ok: false, reason: 'profile-rejected', error: `不允许使用 ${FORBIDDEN_PROFILE}` };
  if (!SPACE_NAME.test(space || '')) return { ok: false, reason: 'bad-space-name', error: `space 名要是 kinso/<平台>/<uid>：${space}` };
  return runEgoScript(buildTaskSource({ space, profileId, params, pluginDir, script }), { egoBin, timeoutMs });
}

/** 关掉指定名字的 space（不存在就什么都不做）。只动 kinso/ 开头的。 */
export async function finishSpace(space, opts = {}) {
  if (!SPACE_NAME.test(space || '')) return { ok: false, reason: 'bad-space-name', error: space };
  return runEgoScript(`const s = (await listTaskSpaces()).find((x) => x.name === ${JSON.stringify(space)});
let r = { closed: false, existed: !!s };
if (s) {
  const t = s.ownership === "agent" ? await taskSpace(s.id) : s.ownership === "user" ? await claimTaskSpace(s.id) : null;
  if (t) r = { existed: true, ...(await t.finish({ keep: [] })) };
}
console.log(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(r));`, opts);
}
