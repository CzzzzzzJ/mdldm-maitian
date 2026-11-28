// 飞书卡片和隧道落盘只用公开地址。口令只留在本机 config.json，不放进链接。
export function publicBoardUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(String(input)); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  u.searchParams.delete('key');
  u.hash = '';
  u.username = '';
  u.password = '';
  const qs = u.searchParams.toString();
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  return `${u.origin}${path}${qs ? `?${qs}` : ''}`;
}

export function tunnelBoardUrl(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return publicBoardUrl((j && (j.base || j.url)) || '');
  } catch { return ''; }
}

// 写入隧道文件并在地址变化时通知。url / base 都是去掉口令之后的公开地址。
export async function publishTunnelAddress(base, { named, gated, readPrev, write, notify, now = () => new Date().toISOString() }) {
  const url = publicBoardUrl(base);
  if (!url) return null;
  const prev = readPrev();
  write({ url, base: url, at: now(), mode: named ? 'named' : 'quick' });
  if (prev !== url) {
    const tail = gated ? '' : '\n链接不含口令。远程访问请打开 Cloudflare Access 或飞书验证码；口令只留在本机 config.json。';
    await notify(`🌐 麦田远程地址${named ? '（固定，不会再变）' : ''}：${url}${tail}`);
  }
  return url;
}
