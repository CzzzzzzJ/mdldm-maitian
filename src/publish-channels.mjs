// 新渠道必须显式加入 batches；旧配置不会自动开始上传到它们。
export const EXTRA_MANUAL = Object.freeze({
  acfun: { name: 'A站', login: 'https://member.acfun.cn/upload-video' },
  kuaishou: { name: '快手', login: 'https://cp.kuaishou.com/article/publish/video' },
});
export const isExtraManual = id => Object.hasOwn(EXTRA_MANUAL, id);
export const extraEnabled = config => Object.keys(EXTRA_MANUAL).filter(id => config.batches?.some(batch => Array.isArray(batch) && batch.includes(id)));
export const unsupportedNewChannels = (platforms, supports) => Object.keys(platforms || {})
  .filter(id => isExtraManual(id) && !platforms[id]?.skip && !supports(id));
export const upgradeMessage = id => `${EXTRA_MANUAL[id].name}：请升级麦田发布助手，当前版本不支持 ${id}；其他渠道不受影响`;

// 仅接受助手明确识别、且形状正确的公开链接，防止把管理页或审核项记为已发布。
export function confirmedLink(id, result) {
  if (result?.status !== '已发布' || typeof result.url !== 'string') return null;
  const pattern = id === 'acfun' ? /^https:\/\/www\.acfun\.cn\/v\/ac\d+$/ : /^https:\/\/www\.kuaishou\.com\/short-video\/[\w-]+$/;
  return pattern.test(result.url) ? result.url : null;
}
