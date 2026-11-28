// Official artwork metadata and SHA-256 digests: platform-artwork.json.
const PLATFORM_ICON = Object.freeze({
  acfun: '/static/platform-acfun.png',
  kuaishou: '/static/platform-kuaishou.png',
  bilibili: '/static/platform-bilibili.png',
  douyin: '/static/platform-douyin.png',
  xhs: '/static/platform-xhs.png',
  youtube: '/static/platform-youtube.png',
  x: '/static/platform-x.png',
  instagram: '/static/platform-instagram.png',
  threads: '/static/platform-threads.png',
  channels: '/static/platform-channels.png',
  wechat: '/static/platform-wechat.png',
});
let hasSiteLogo = false;
const setSiteLogo = (enabled) => { hasSiteLogo = Boolean(enabled); };
const logo = (platform) => {
  const id = String(platform).split('@')[0];
  if (id === 'zsz') {
    return hasSiteLogo ? '<span class="lg"><img src="/site-logo" alt=""></span>'
      : '<span class="lg" style="--bg:#5e5ce6" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="#fff"/></svg></span>';
  }
  return Object.hasOwn(PLATFORM_ICON, id) ? `<span class="lg platform-icon"><img src="${PLATFORM_ICON[id]}" alt=""></span>` : '';
};
