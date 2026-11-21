// 麦田入口（本机私有扩展版）：先挂 collectors.wechat / followerCollectors.wechat，再跑原 hub。
// 用法与 src/hub.mjs 完全一致：node src/hub.local.mjs metrics EP.01 / doctor / run …
import './metrics.local.mjs';
import './followers.local.mjs';
await import('./hub.mjs');
