// 扩展点：在这里注册额外的平台适配器（比如自己的网站）。
// wechat：公众号（本机私有适配器，见 ./private/wechat.js；只建草稿，群发由人点）
import wechat from './private/wechat.js';
export const adapters = { wechat };
