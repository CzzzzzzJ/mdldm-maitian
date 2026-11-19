# 07 评论页、私信页只读适配器探针

**判定：通过。** 抖音、小红书、视频号三个平台的评论和私信都能读出列表、定位回复框，填入「测试」后清空，读回为空。「是否已回复」只做到部分，见各平台。小红书评论列表的渲染不稳定，见小红书一节。

| 平台 | 评论 | 私信 |
|---|---|---|
| 抖音 | **通过**（「是否已回复」部分） | **通过** |
| 小红书 | **通过**（列表渲染不稳，要读挂钩到的接口） | **通过** |
| 视频号 | **通过**（「是否已回复」部分） | **通过** |

全程没有点发送或发布，没有按 Enter，没有点赞、删除、置顶、拉黑。每次填入「测试」后都清空了，并读回确认为空。打开私信会话或评论会把它标成已读，这在任务允许范围内。

2026-11-19 复测。space：抖音 183、小红书 184、视频号 172。

## 小红书创作者中心有没有私信页

**没有。** `creator.xiaohongshu.com` 的侧栏只有首页、笔记管理、Builder hub、小工具、Red Skill、数据看板、活动中心、笔记灵感、创作学院、创作百科，没有评论管理和私信。评论和私信都在主站 `www.xiaohongshu.com`，和创作者中心共用登录态（同一个 space 的 cookie），所以适配器在同一个 space 里切到主站即可。

## 抖音

```sh
spikes/platform/run.sh spikes/platform/07-engage-douyin.mjs
```

11-19 复测：评论读到 6 条（默认最新作品），私信读到 20 个会话，回复框和私信框都填入后清空成功。

### 评论

- **列表来源**：从任一评论的「回复」入口（`[class*=operations-] > div`，文字为「回复」）沿 React fiber 往上 12 层，有一个 Context Provider，它的 `memoizedProps.value.dataSource` 就是评论数组，结构和接口 `comment/list/select` 一样。同一个 Context 上还有 `updateCommentItem`、`deleteCommentItem`、`addCommentReply`、`addComment` 几个写函数，没有调用。
- **接口**：`/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/` 带 `msToken` 和 `a_bogus` 签名，**不能直接 `page.fetch`**。要么读页面数据，要么挂钩页面自己发的请求。
- **字段**：commentId ← `cid`；postId ← `aweme_id`；昵称 ← `user.nickname`；评论者 uid ← `user.uid`；内容 ← `text`；时间 ← `create_time`（秒）；子回复数 ← `reply_comment_total`；IP 属地 ← `ip_label`。
- **是否已回复：部分。** 列表里只有 `reply_comment_total`，没有「作者已回复」的标志；子回复渲染在别的组件里。下一步可以挂钩展开时的子回复接口，看有没有 `user.uid == 106707338905`。
- **范围**：一次只显示一个作品的评论（顶部「选择作品」，默认最新作品）。作品下拉来自 `GET /aweme/v1/creator/item/list`。
- **回复框**：点「回复」后，`[class*=reply-content-] [contenteditable=true]`，类名 `input-*`，placeholder「回复 <昵称>：」。不在 iframe、不在 shadow DOM。页面顶部还有一个给作品发一级评论的 contenteditable，适配器必须用 `[class*=reply-content-]` 限定。

### 私信

- **列表来源**：`li.semi-list-item` 的 React fiber 往上 2 层，`memoizedProps.item` 是 IM SDK 的 Conversation 对象：`id`（形如 `0:1:<uidA>:<uidB>`）、`toParticipantUserId`、`isStrangerChat`、`unreadCount`、`lastMessage`（`content` 是 JSON 字符串，文字取 `.text`；`type` 文字 7、分享视频 8；`isFromMe`；`createdAt`）。
- **最后一句是谁说的**：`lastMessage.isFromMe`。
- **接口**：消息走 IM 长连接，会话列表只能读组件数据。
- **输入框**：`[class*=chat-editor-] [contenteditable=true]`（`chat-input-*`），不在 iframe、不在 shadow DOM；脚本只认唯一的那个。

## 小红书（主站）

```sh
spikes/platform/run.sh spikes/platform/07-engage-xhs.mjs
```

最后一次运行：评论读到 20 条，私信读到 57 个会话，回复框和私信框都填入后清空成功。

### 评论

- **入口**：`https://www.xiaohongshu.com/notification`，默认标签「评论和@」。
- **列表来源**：页面自己发的 `GET edith.xiaohongshu.com/api/sns/web/v1/you/mentions`（挂钩抄回 JSON），`data.message_list[]`，用 `cursor`（`strCursor`）和 `has_more` 翻页。DOM 上没有 Vue 实例可读。
- **字段**：通知 id ← `id`；类型 ← `type`（`comment/item` 评论了笔记，`comment/comment` 回复了评论）；标题 ← `title`；时间 ← `time`（秒）；评论者 ← `user_info.nickname` / `user_info.userid`；commentId ← `comment_info.id`；内容 ← `comment_info.content`；被回复的评论 ← `comment_info.target_comment`（`id`、`content`、`user_info`）；笔记 ← `item_info.id`（另有 `item_info.xsec_token`，不要存）。
- **是否已回复：部分。** 这个列表是别人给我的评论，没有「我已回复」的标志；`target_comment.user_info` 是自己时，说明对方回复的是我的评论。
- **回复框**：点 `.action-reply`（文字「回复」）后出现 `textarea.comment-input`，placeholder「回复 <昵称>」，旁边是「发送」按钮（没点）。不在 iframe、不在 shadow DOM。
- **不稳定**：11-19 在脚本里跑了 6 次，有 3 次列表一直没渲染出来（停在空白或骨架屏），但同时挂钩到的 `you/mentions` 每次都是 `code=0`、有数据。找到的原因有一个：「评论和@」已经是选中标签时再点它，列表就不出来，脚本已改成只在没选中时点；改完后仍失败过 1 次。手动等待时列表有时要 30 秒以上才出来。**适配器读列表应以挂钩到的接口为准，不要依赖 DOM**；要点回复时再等 `.action-reply` 出现（最长 60 秒）。

### 私信

- **入口**：`https://www.xiaohongshu.com/chat`（主站侧栏「消息」）。
- **列表来源**：页面自己发的 `GET /api/im/web/v3/chats`（挂钩抄回），`data.chats[]`，`next_ts` 翻页。会话行 DOM 是 `.xhs-im-conv-item`。
- **字段**：对方 uid ← `chat_user_id`（`user_id` 是自己）；对方昵称 ← `info.nickname`；最后一句 ← `last_msg_content`；最后时间 ← `last_msg_time`（毫秒）。另有 `info.is_official`、`info.is_brand`、`info.is_friend`、`info.follow_status`。
- **最后一句是谁说的：部分。** 会话列表只有 `last_msg_content`，没有发送方；要判断得打开会话读消息。
- **输入框**：打开会话后 `div.xhs-im-input-bar-editor`（placeholder「发消息」），不在 iframe、不在 shadow DOM。**官方号推送会话没有输入框**（这次排第一的「[笔记] 📢…」就是），脚本依次试前 3 个会话，第 2 个有输入框。

## 视频号

```sh
spikes/platform/run.sh spikes/platform/07-engage-channels.mjs
```

评论读到 1 个作品的 1 条一级评论（脚本挑第一个评论数 >0 的作品），私信读到 27 个会话，回复框和私信框都填入后清空成功。

视频号助手的业务页面在 **wujie 微前端**里：DOM 在 `<wujie-app>` 的 shadowRoot，请求从沙箱 iframe（`empty.html`）发出，**外层页面挂钩抓不到接口**（07-engage-discover 只抓到外层的 auth/helper 请求）。所以列表都读 Vue 2 组件（元素上的 `__vue__`）。`page.click` 的 CSS 选择器能搜到开放的 shadowRoot，在里面打 `data-spike` 标记再点就行。

### 评论

- **入口**：`https://channels.weixin.qq.com/platform/interaction/comment`（互动管理 → 评论）。左边是作品列表 `.comment-feed-wrap`（显示「共62个」，每项 `.feed-comment-total` 是评论数），点一个作品，右边出评论。
- **列表来源**：`.comment-item` 元素的 `__vue__.$props.dataSource`。
- **字段**：commentId ← `commentId`；昵称 ← `commentNickname`；评论者 ← `username`（这次是空字符串）；内容 ← `commentContent`；时间 ← `commentCreatetime`（秒，字符串）；已读 ← `readFlag`（打开作品后变 true）；点赞数 ← `commentLikeCount`；楼中楼 ← `levelTwoComment[]`（多 `replyCommentId`、`replyContent`）。
- **是否已回复：部分。** 作者回复出现在 `levelTwoComment` 里，DOM 上作者回复有 `.comment-author-bandage`（作者标）；数据里没有明确的「作者」字段，可用昵称等于 `finderUser.nickname` 判断，这次没逐条核对。
- **回复框**：点 `.weui-icon-outlined-comment`（tooltip「回复」）后出现 `textarea.create-input`，placeholder「回复 <昵称>」。在 wujie shadowRoot 里，不在 iframe。旁边的 `.like-action` 是点赞，脚本不碰。

### 私信

- **入口**：`https://channels.weixin.qq.com/platform/private_msg`，「全部私信 共27个」。
- **列表来源**：从 `.session-wrap` 往上找到有 `$data.sessionList` 的 Vue 实例。每项是 `[sessionId, { sessionInfo, messageList, newMsgCount, sessionIsUnread, sessionType }]`；`sessionInfo` 有 `sessionId`、`username`（对方）、`nickname`、`fromUserType`。
- **最后一句是谁说的**：`messageList[].message` 有 `fromUsername`、`toUsername`、`ts`（秒）、`msgType`、`textMsg.content`。**`messageList` 是新到旧排的，只带最近 2 条**，取 `ts` 最大的那条，`fromUsername == sessionInfo.username` 是对方说的。改成这样后，前 3 个会话都判成「我」最后回复，和会话行显示的时间、内容一致。
- **输入框**：打开会话后 `textarea.edit_area`，在 wujie shadowRoot 里。

## 脱敏样例

各脚本输出里的 `sample` 已脱敏：第三方昵称和 uid 换成 `user_<sha256 前 8 位>`，正文只留前 6 个字。原始数据在 `scratch/07-*.json`（已 gitignore）。

```json
{"platform":"视频号","dm":{"sessionId":"user_2e3ad0ee","peerUid":"user_6f83a1fe","peerNickname":"user_68da6265","unread":true,"lastType":1,"lastBy":"me","lastAt":"2026-11-17T16:12:03.000Z","lastMessage":"虚拟信用卡这…"}}
{"platform":"视频号","comment":{"commentId":"15057219412199213204","nickname":"user_1208ce0d","text":"你用fabl…","time":"2026-11-18T00:07:08.000Z","replyCount":0}}
{"platform":"小红书","comment":{"id":"7709325748931241644","type":"comment/comment","title":"评论了你的笔记","time":"2026-11-18T02:01:15.000Z","nickname":"user_191f784f","commentId":"6afd06e6000000002f036d96","text":"Claude…","noteId":"6afbd09e00000000250132bd"}}
{"platform":"抖音","comment":{"commentId":"7709328922249741096","postId":"7708984451971452170","replyToNickname":"user_d7ed164c","uid":"user_aa2e9936","text":"哥你是怎么充…","time":"2026-11-18T02:13:37.000Z","replyCount":0}}
```

## 不通过时的替代路线（只记录）

- 组件数据结构变了：抖音挂钩 `comment/list/select`；小红书本来就读接口；视频号要在 wujie 沙箱 iframe 里挂钩（`empty.html` 的 window），这次没做。
- 回复框定位失败：用 `page.snapshot()` 按 placeholder「回复 」定位。
