// 「自有站点」接口（可选）：你自己的课程站 / 会员站。不配 config.site 就整块关掉——
// 不建课、不采站点流量和注册，网页上也不显示站点那一格和「转化」页。
//
// 站点需要提供两个接口（用浏览器里管理员登录态去调，howieip-studio 不存密码）：
//   coursesApi   GET → { courses: [{ _id, title, seriesId, visibilityStatus: 'published'|..., viewCount, publishedAt }] }
//   dashboardApi GET → { funnel: { totalRegistered }, registrationTrend: [{ date, count, vipCount }], revenueTrend: [{ date, count, revenue }],
//                        channelStats: [{ source, registeredCount, vipCount, orderCount, revenue }], campaignStats?: [{ campaign, sources, ... }] }
// 建课（上传成片）走发布插件里的站点适配器。
// 每次调用现算：偏好页改完 config.site，不用重启守护进程。
import { config } from './feishu.mjs';

export function getSite() {
  const S = config.site && config.site.base ? config.site : null;
  if (!S) return null;
  const base = String(S.base).replace(/\/$/, '');
  const coursePath = S.coursePath || '/series/{seriesId}?courseId={id}';
  return {
    name: S.name || '知识站',
    base,
    admin: base + (S.adminPath || '/admin'),
    coursesApi: S.coursesApi || '/api/courses?admin=1',
    dashboardApi: S.dashboardApi || '/api/admin/dashboard',
    courseUrl: (c) => base + coursePath.replace('{seriesId}', c.seriesId).replace('{id}', c.id || c._id),
  };
}
