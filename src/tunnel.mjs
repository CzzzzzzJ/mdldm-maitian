// 麦田公网隧道 → 拿到 https 地址 → 存 data/tunnel.json（飞书卡片里的「打开麦田」用它）+ 地址变了推飞书。
// 落盘和飞书都只放公开地址，不带 web.key。远程打开要靠 Cloudflare Access 或飞书验证码。
// 两种模式：
//  - 固定域名（推荐）：config.tunnel = { name, hostname }，先 `cloudflared tunnel login`、`cloudflared tunnel create <name>`、
//    `cloudflared tunnel route dns <name> <hostname>`。地址永远不变。
//  - 快速隧道（默认）：没配 config.tunnel 时用 trycloudflare.com，不用账号，但每次重启地址都会变。
import { spawn } from 'child_process';
import fs from 'fs'; import path from 'path';
import { pathToFileURL } from 'node:url';
import { notify, config } from './feishu.mjs';
import { publicBoardUrl, publishTunnelAddress } from './tunnel-url.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data', 'tunnel.json');

const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (main) {
const port = config.web?.port || 8787;
const named = config.tunnel?.name && config.tunnel?.hostname;
const gated = !!(config.web?.access || config.web?.login === 'feishu');
const CF = config.tunnel?.bin || '/opt/homebrew/bin/cloudflared';
// QUIC 在不少网络下被拦，统一走 http2
const args = named
  ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--url', `http://127.0.0.1:${port}`, config.tunnel.name]
  : ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'];
const cf = spawn(CF, args, { stdio: ['ignore', 'pipe', 'pipe'] });

async function publish(base) {
  await publishTunnelAddress(base, {
    named, gated, notify,
    readPrev: () => { try { return publicBoardUrl(JSON.parse(fs.readFileSync(OUT, 'utf8')).url); } catch { return null; } },
    write: (rec) => fs.writeFileSync(OUT, JSON.stringify(rec, null, 2)),
  }).catch(e => console.error(e.message));
}
let sent = false;
// 自愈：Clash TUN 用 fake-ip，Clash 重启后 cloudflared 手里缓存的 198.18.x 地址作废，会一直 TLS EOF 重试却不重新解析
// （2026-11-17 断了一天多）。连续 10 分钟连不上就退出，让 launchd 重启进程重新解析。
let downSince = null;
setInterval(() => { if (downSince && Date.now() - downSince > 10 * 60e3) { console.error('隧道 10 分钟连不上，退出重启'); cf.kill(); process.exit(1); } }, 60e3);
const onData = async (buf) => {
  const s = buf.toString(); process.stdout.write(s);
  if (/Registered tunnel connection/.test(s)) downSince = null;
  else if (/Unable to establish connection|Connection terminated/.test(s)) downSince ??= Date.now();
  if (sent) return;
  if (named && /Registered tunnel connection/.test(s)) { sent = true; await publish(`https://${config.tunnel.hostname}`); }
  const m = !named && s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) { sent = true; await publish(m[0]); }
};
cf.stdout.on('data', onData); cf.stderr.on('data', onData);
cf.on('exit', (c) => { console.error('cloudflared 退出', c); process.exit(1); });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { cf.kill(); process.exit(0); });
}
