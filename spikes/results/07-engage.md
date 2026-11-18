# 07 评论页、私信页只读适配器探针

| 平台 | 评论 | 私信 |
|---|---|---|
| 抖音 | **通过**（「是否已回复」只做到部分，见下） | **通过** |
| 视频号 | 等扫码 | 等扫码 |
| 小红书 | 等扫码 | 等扫码（创作者中心有没有私信页还没确认） |

全程没有点发送或发布，没有按 Enter，没有点赞、删除、置顶、拉黑。填入的「测试」两个字每次都清空了，并读回确认是空的。打开私信会话可能会把它标成已读，这在任务允许范围内。

## 抖音

### 怎么测

```sh
spikes/platform/run.sh spikes/platform/07-engage-douyin.mjs
```

在 space 66 里依次做下面几步：

1. 打开评论管理页 `https://creator.douyin.com/creator-micro/interactive/comment`，读评论列表。
2. 点第一条评论的「回复」入口，定位回复框，`Input.insertText` 填「测试」，读回，`ControlOrMeta+A` 加 `Backspace` 清空，再读回。
3. 打开私信页 `https://creator.douyin.com/creator-micro/data/following/chat`，读会话列表。
4. 点开第一个会话，定位输入框，同样填入、读回、清空、读回。

原始数据存在 `scratch/07-douyin-*.json`。

### 评论

- **列表来源**：从任一评论的「回复」入口（`[class*=operations-] > div`，文字为「回复」）沿 React fiber 往上 12 层，有一个 Context Provider，它的 `memoizedProps.value.dataSource` 就是评论数组，结构和接口 `comment/list/select` 一样。
  - 同一个 Context 上还有 `updateCommentItem`、`deleteCommentItem`、`addCommentReply`、`addComment` 几个写函数，没有调用。
  - 单条评论组件（fiber `.return` 一层）的 props 也有 `id`、`uid`、`username`、`content`、`publishTime`、`isAuthor`、`replyComments`。
- **接口**：`/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/` 带 `msToken` 和 `a_bogus` 签名，**不能直接 `page.fetch`**。要么读页面数据，要么挂钩页面自己发的请求。
- **字段**：

  | 契约字段 | 抖音字段 |
  |---|---|
  | commentId | `cid` |
  | postId | `aweme_id` |
  | 昵称（`replyToNickname`） | `user.nickname` |
  | 评论者 uid | `user.uid` |
  | 内容 | `text` |
  | 时间 | `create_time`（秒） |
  | 子回复数 | `reply_comment_total` |
  | IP 属地 | `ip_label` |

- **是否已回复：部分。** 列表里只有 `reply_comment_total`（子回复数），没有「作者已回复」的标志。展开「查看 N 条回复」后，一级评论组件的 `replyComments.list` 是空的，子回复渲染在别的组件里，这次没找到作者回复的标记。
  - 下一步可以挂钩展开时页面发的子回复接口（`comment/list/reply` 类），看里面有没有 `user.uid == 106707338905`。
- **范围**：评论页一次只显示一个作品的评论（顶部「选择作品」，默认是最新作品，这次读到 6 条）。作品下拉列表来自 `GET /aweme/v1/creator/item/list`，有 `item_id` 和 `comment_count`。要遍历多个作品，得在页面上切换作品。
- **回复框**：点「回复」后，该条评论下面出现 `[class*=reply-content-] [contenteditable=true]`，类名 `input-*`，placeholder 是「回复 <昵称>：」。
  - 不在 iframe 里，也不在 shadow DOM 里。
  - 旁边有「取消」和「发送」两个按钮，「发送」在填入后变成可点击，没有点它。
  - 填入后读回 `"测试"`，清空后读回 `""`。没有自动发送。
- **注意**：页面顶部还有一个「有爱评论，说点好听的~」的 contenteditable，是给作品发一级评论用的。适配器必须用 `[class*=reply-content-]` 限定，不能拿第一个可编辑区。
- **前台**：用 `page.click` 和 CDP 输入，不需要把页面切到前台。

脱敏样例：

```json
{"commentId":"7709328922249741096","postId":"7708984451971452170","replyToNickname":"user_d7ed164c","uid":"user_aa2e9936","text":"哥你是怎么充…","time":"2026-11-18T02:13:37.000Z","replyCount":0}
{"commentId":"7709180408285365049","postId":"7708984451971452170","replyToNickname":"user_b7f938d0","uid":"user_05bb3598","text":"别用fabl…","time":"2026-11-17T16:37:18.000Z","replyCount":3}
```

### 私信

- **列表来源**：每个会话行 `li.semi-list-item` 的 React fiber 往上 2 层，`memoizedProps.item` 是 IM SDK 的 Conversation 对象。
  - 可读字段：`id`（会话 id，形如 `0:1:<uidA>:<uidB>`，含对方 uid）、`shortId`、`toParticipantUserId`、`isStrangerChat`、`unreadCount`、`lastMessage`。
  - `lastMessage` 是 getter，有 `content`（JSON 字符串，文字消息取 `.text`）、`type`、`sender`、`isFromMe`、`createdAt`。
  - **最后一句是谁说的**：直接看 `lastMessage.isFromMe`，或者比较 `sender` 是不是自己的 uid。
  - 对方昵称从 DOM 行文本读，Conversation 对象上没有昵称。
- **接口**：消息走 IM 长连接，页面的 JSON 请求只有 `/aweme/v1/creator/im/user_detail/`（拉对方资料）和 `im/user_token`。会话列表不能用 `page.fetch` 拿，只能读组件数据。
- **会话列表**：一屏是虚拟列表，这次读到 20 个会话。有「全部 / 朋友私信 / 陌生人私信 / 群消息」几个分组。
- **输入框**：点开会话后，`[class*=chat-editor-] [contenteditable=true]`，类名 `chat-input-*`。
  - 不在 iframe 里，也不在 shadow DOM 里。
  - 填入后读回 `"测试"`，清空后读回 `""`。
  - 脚本只认聊天编辑器里唯一的那个输入框，找不到或不唯一就不填。
- `lastMessage.type`：文字是 7，分享视频是 8（这次的观察）。非文字消息的 `text` 为空。

脱敏样例：

```json
{"conversationId":"user_681ee324","peerNickname":"user_eb0d5884","peerUid":"user_2051ce09","lastMessage":"我加您了同意…","lastType":7,"lastFromMe":false,"lastBy":"peer","lastAt":"2026-11-17T06:27:37.024Z","stranger":false}
{"conversationId":"user_d08b7a0c","peerNickname":"user_286bcc0a","peerUid":"user_87293d55","lastMessage":"这些在平台上…","lastType":7,"lastFromMe":true,"lastBy":"me","lastAt":"2026-11-16T07:50:20.971Z","stranger":false}
```

## 视频号、小红书

**等扫码**（space 80、67 未登录，已 handOff）。扫码后先跑第一轮探查：

```sh
spikes/platform/run.sh spikes/platform/07-engage-discover.mjs '{"platform":"Channels","takeOver":true}'
spikes/platform/run.sh spikes/platform/07-engage-discover.mjs '{"platform":"XiaoHongShu","takeOver":true}'
```

这一轮只读，不填任何输入框。它会输出：

- 首页导航里和评论、私信相关的入口。视频号助手的页面在 wujie 微前端的 shadowRoot 里，所以会连 shadowRoot 一起扫。
- 评论页、私信页上页面自己发的接口路径和键名。
- 所有可编辑区的位置：在 document 还是 shadow 里，有没有 iframe。

视频号的页面地址先按 `/platform/interaction/comment` 和 `/platform/private_msg` 试，没经过验证。小红书创作者中心可能没有私信页，需要看导航结果。确认输入框选择器后，再照 `07-engage-douyin.mjs` 的 `fillAndClear` 做填入和清空。

## 不通过时的替代路线（只记录）

- 组件数据结构变了：挂钩页面自己发的列表接口（`installHook`）读 JSON。抖音评论走 `comment/list/select`。
- 回复框定位失败：用 `page.snapshot()` 按 placeholder「回复 」定位。
