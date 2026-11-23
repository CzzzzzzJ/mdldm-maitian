# 参与麦田

谢谢你愿意一起把麦田做好。麦田最需要的贡献是**接更多平台**和**修平台改版**，其次是安装体验、Windows 兼容和数据看板。

## 先了解麦田的三个部分

| 部分 | 在哪 | 负责什么 |
|---|---|---|
| 麦田 Skill | 本仓库 `skills/maitian-publish/` | 看片、按平台规则写文案，生成清单 `publish.json` 并校验 |
| 麦田本体 | 本仓库 `src/` | 调度、任务状态、防重、取链接、每天采数据、飞书通知、网页大屏 |
| 麦田发布助手 | [mdldm-maitian-publisher](https://github.com/CzzzzzzJ/mdldm-maitian-publisher)（Chrome 插件） | 在用户自己的浏览器里打开各平台上传页，填写并核对 |

## 接一个新平台：动三个地方

1. **规则**（让 Skill 和校验器知道这个平台的规矩）
   - 发布助手 `lib/bundle.js` 的 `PLATFORMS`：标题 / 正文字数范围、话题上限、能不能放链接；
   - 本仓库 `src/make-publish.mjs`：从「发布素材.md」里取这个平台的字段、选哪张封面；
   - `skills/maitian-publish/SKILL.md`：补一节这个平台的写法。
2. **适配器**（让发布助手知道在这个平台上怎么填）
   - 发布助手 `lib/platforms/<平台>.js`，照着 `xhs.js` / `bilibili.js` 写：`id`、`name`、`url`（上传页）、`ready`（页面准备好的判断）、`fill(ctx)`（传视频、传封面、填文案、回读核对、设定时）、`links`（发布后怎么找回作品链接）；
   - 国内平台**只填写、不点发布**，最后一下留给用户。
3. **采集**（让本体每天读回数据）
   - 本仓库 `src/metrics.mjs` 的 `collectors`：给定作品链接，读回播放、点赞、评论、收藏、转发；
   - `src/followers.mjs`：读粉丝数；
   - `src/hub.mjs` 的 `ALL_IDS` 和 `LOGIN_PAGES`：登记平台和登录页；`src/db.mjs` 的 `NAMES`：中文名。

先用只填不发的方式在真实页面上跑通（发布助手里有 `tools/try-adapter.mjs`），再提 PR。

## 提 PR 前

- 一个 PR 只做一件事。大改动先开 issue 或在 [Discussions](https://github.com/CzzzzzzJ/mdldm-maitian/discussions) 里聊方案。
- 不要提交任何账号、Cookie、token、个人数据或截图里的隐私信息。
- `node --test tests/` 能过；改了页面逻辑，附一张前后对比截图。
- 写清楚在什么系统、什么版本上验证过。

## 不知道从哪开始？

看带 [`good first issue`](https://github.com/CzzzzzzJ/mdldm-maitian/labels/good%20first%20issue) 标签的 issue，或者在 Discussions 的 [Show and tell](https://github.com/CzzzzzzJ/mdldm-maitian/discussions/categories/show-and-tell) 晒一晒你自己改的版本。合入的贡献会写进 [SHOWCASE.md](SHOWCASE.md)，并在麦当的视频 / X 上点名感谢。
