# 公众号可选平台接入示例

公众号通过插件适配器与宿主扩展点接入；仅在 config.batches 中包含 wechat 时注册到现有平台清单。停用/启用、单平台登录和体检复用系统页原有机制，停用状态只写 config.disabled，不增加 meta 开关。

> 只对**自己的**公众号生效：全程用你本机浏览器里已登录的网页会话，不存密码，也不调用任何第三方服务。

## 组成

宿主侧（拷到仓库 `src/`）：

| 文件 | 作用 |
|---|---|
| `src/metrics.local.mjs` | `collectors.wechat`：读 `/cgi-bin/appmsgpublish` 的阅读、点赞、在看、评论 |
| `src/followers.local.mjs` | `followerCollectors.wechat`：读「用户分析」页表格里的累计关注人数 |
| `src/make-publish.local.mjs` | `extend()` 钩子：解析发布素材 md 的 `## 十一、公众号` 节，生成草稿正文 HTML |
| `src/hub.local.mjs` | 入口包装：先挂上前两个 local，再跑 `hub.mjs`，用法与原入口完全一致 |

插件侧（拷到插件目录对应位置）：

| 文件 | 作用 |
|---|---|
| `extension/lib/platforms/private/wechat.js` | 适配器：封面转 900×383 传图床 + `operate_appmsg` 建草稿 |
| `extension/lib/platforms/extra.js` | 注册 `wechat`（`adapters = { wechat }`） |
| `extension/lib/platforms/extra-specs.js` | 校验规则：标题 ≤64、摘要 ≤120、正文纯文本 ≤2 万（链接走「阅读原文」，所以 `links: true`） |
| `licenses/Apache-2.0.txt` | 草稿字段表参考了 [xihe-lab/wechat-mp-mcp-server](https://github.com/xihe-lab/wechat-mp-mcp-server)（Apache-2.0），许可证副本放这里 |

## 装

1. **插件**：把 `extension/lib/platforms/` 下的三个文件放进去。
   商店版插件在 `chrome-profile/Default/Extensions/<插件ID>/<版本>_0/`；自己维护副本时用 `config.plugin = "local"` + `config.pluginDir` 指向插件目录。
2. **宿主**：把 `src/` 下四个 `.local.mjs` 拷到仓库 `src/`（`.gitignore` 默认忽略 `src/*.local.mjs`）。
3. **config.json**：`batches` 里加 `["wechat"]`，`manual` 里加 `"wechat"`。
启用配置后重启麦田。系统页会出现「公众号」，可按原有按钮停用、登录、体检。

4. **入口**：用 `node src/hub.local.mjs` 代替 `node src/hub.mjs`（不挂扩展点时两者行为一致）。
5. **发布素材 md**：末尾加一节

   ```md
   ## 十一、公众号
   **标题：**
   标题写这里（≤64 字）
   **摘要：**
   一句摘要（≤120 字）
   **阅读原文：**
   https://example.com/your-link
   **正文：**
   第一段。

   第二段，空行分段。
   ```

   正文按空行分段生成 `<p>`，连续 `·`/`-` 开头的行合成列表。链接写在「阅读原文」里，不受「国内平台正文禁链接」的校验。

## 行为

- **发布＝建草稿，不自动群发**：公众号没有「填好等你自己点发布」的页面式流程，适配器只把图文存进草稿箱；什么时候发、是否群发，由你在后台点。账号具体发表与群发额度以后台为准，本示例不调用群发接口。
- **采集按标题精确匹配**：`appmsgpublish` 里找不到就返回空，不会拿别人文章的数。标题改过的话按内容链接 slug 也能找到。
- **粉丝只读「详细数据表格」**：用户分析页的趋势图坐标轴里也有日期，直接正则会把坐标轴当数据行，所以要跳过表格之前的部分。

## 已知限制

- 依赖网页登录态；过期后要重新扫码。
- 后台接口不是公开 API，字段结构可能变；接口异常时会走「未登录 / 采集为空」，不会写脏数据。
- 封面会居中裁切成 900×383 再传图床。
