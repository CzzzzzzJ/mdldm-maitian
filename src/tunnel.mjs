// 麦田公网隧道 → 拿到 https 地址 → 存 data/tunnel.json（飞书卡片里的「打开麦田」用它）+ 地址变了推飞书
// 两种模式：
//  - 固定域名（推荐）：config.tunnel = { name, hostname }，先 `cloudflared tunnel login`、`cloudflared tunnel create <name>`、
//    `cloudflared tunnel route dns <name> <hostname>`。地址永远不变。
//  - 快速隧道（默认）：没配 config.tunnel 时用 trycloudflare.com，不用账号，但每次重启地址都会变。
import { spawn } from 'child_process';
import fs from 'fs'; import path from 'path';
import { notify, config } from './feishu.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data', 'tunnel.json');
const port = config.web?.port || 8787, key = config.web?.key;
const isHost = (h) => typeof h === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h);
const named = !!config.tunnel?.name && isHost(config.tunnel?.hostname);
if (config.tunnel && !named) console.error(`config.tunnel.hostname 不是域名（${config.tunnel.hostname}），改用临时地址；要固定域名见 README`);
const CF = config.tunnel?.bin || '/opt/homebrew/bin/cloudflared';
// QUIC 在不少网络下被拦，统一走 http2
const args = named
  ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--url', `http://127.0.0.1:${port}`, config.tunnel.name]
  : ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'];
const cf = spawn(CF, args, { stdio: ['ignore', 'pipe', 'pipe'] });

async function publish(base) {
  // 有登录页就不把口令推出去：飞书验证码登录任何地址都能用；Cloudflare Access 只挂在固定域名上
  const login = (config.web?.login === 'feishu' && config.feishuWebhook) || (named && config.web?.access);
  const url = login || !key ? base : `${base}/?key=${key}`;
  let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).url; } catch {}
  fs.writeFileSync(OUT, JSON.stringify({ url, base, at: new Date().toISOString(), mode: named ? 'named' : 'quick' }, null, 2));
  if (prev !== url) await notify(`🌐 麦田远程地址${named ? '（固定，不会再变）' : ''}：${url}`).catch(e => console.error(e.message));
}
let sent = false;
const onData = async (buf) => {
  const s = buf.toString(); process.stdout.write(s);
  if (sent) return;
  if (named && /Registered tunnel connection/.test(s)) { sent = true; await publish(`https://${config.tunnel.hostname}`); }
  const m = !named && s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) { sent = true; await publish(m[0]); }
};
cf.stdout.on('data', onData); cf.stderr.on('data', onData);
cf.on('exit', (c) => { console.error('cloudflared 退出', c); process.exit(1); });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { cf.kill(); process.exit(0); });
