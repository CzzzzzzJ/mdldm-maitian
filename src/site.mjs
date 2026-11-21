// 「自有站点」接口（可选）：你自己的课程站 / 会员站。不配 config.site 就整块关掉——
// 未配置时，转化页展示接入说明。站点数据与建课操作只在启用对应站点时开放。
//
// 站点需要提供两个接口（用浏览器里管理员登录态去调，麦田不存密码）：
//   coursesApi   GET → { courses: [{ _id, title, seriesId, visibilityStatus: 'published'|..., viewCount, publishedAt }] }
//   dashboardApi GET → { funnel: { totalRegistered }, registrationTrend: [{ date, count, vipCount }], revenueTrend: [{ date, count, revenue }],
//                        channelStats: [{ source, registeredCount, vipCount, orderCount, revenue }], campaignStats?: [{ campaign, sources, ... }] }
// 建课（上传成片）走发布插件里的站点适配器。
import { config, onConfigChange } from './feishu.mjs';
import { configuredPlatforms } from './targets.mjs';

// 可展示已填写的站点设置；实际采集与建课同时服从统一的平台开关。
export function siteOn(s = config.site) { return !!s && s.enabled !== false && (s !== config.site || configuredPlatforms(config).includes('zsz')); }
export function siteEnabled(s = config.site) { return siteOn(s) && !!s.base; }
export let SITE = null;
let siteConfig;
export function refreshSite() {
  const s = siteEnabled() ? config.site : null;
  // 同一配置在页面轮询时保持同一对象，采集期间可以识别站点变更。
  const next = JSON.stringify(s);
  if (siteConfig === next) return SITE;
  siteConfig = next;
  SITE = s && {
    name: s.name || '知识站',
    base: s.base.replace(/\/$/, ''),
    admin: s.base.replace(/\/$/, '') + (s.adminPath || '/admin'),
    coursesApi: s.coursesApi || '/api/courses?admin=1',
    dashboardApi: s.dashboardApi || '/api/admin/dashboard',
    courseUrl: (c) => s.base.replace(/\/$/, '') + (s.coursePath || '/series/{seriesId}?courseId={id}').replace('{seriesId}', c.seriesId).replace('{id}', c.id || c._id),
  };
  return SITE;
}
onConfigChange(refreshSite);
refreshSite();
