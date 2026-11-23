// 知乎视频：发布素材解析，以及作品数据、粉丝数的纯映射。页面请求留在采集器里。

const clean = (s) => s.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

/** 取 **标签：** 后、下一个加粗字段前的正文。 */
function field(text, label) {
  const re = new RegExp(`\\*\\*${label}：\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*\\n]+：\\*\\*|$)`);
  const m = text.match(re);
  return m ? clean(m[1]) : null;
}

/** 从一行「#话题」里取出话题名。 */
function hashTags(line) {
  return (line.match(/#[^\s#]+/g) || []).map((t) => t.slice(1));
}

/** 正文最后一行如果全是话题，就拆出去。 */
function splitTopics(body) {
  const lines = body.split('\n');
  const last = lines[lines.length - 1].trim();
  if (last && last.split(/\s+/).every((w) => w.startsWith('#'))) {
    return { body: clean(lines.slice(0, -1).join('\n')), topics: hashTags(last) };
  }
  return { body, topics: [] };
}

/** 从发布素材的知乎节取出标题、简介和话题。 */
export function zhihuCopy(section) {
  const topicLine = field(section, '话题');
  const raw = field(section, '简介') || '';
  const body = topicLine != null ? { body: raw, topics: hashTags(topicLine) } : splitTopics(raw);
  return { title: field(section, '标题'), body: body.body, topics: body.topics };
}

/** 把知乎视频接口的计数字段映射成麦田的播放、赞同、评论、收藏。 */
export function zhihuStats(video) {
  if (!video || video.play_count == null) return null;
  const likes = video.voteup_count ?? video.liked_count ?? null;
  const favorites = video.collected_count ?? video.favlists_count ?? video.favorite_count ?? null;
  return {
    views: video.play_count,
    likes,
    comments: video.comment_count ?? null,
    favorites,
  };
}

/** 从作品链接取出 zvideo id；不是视频链接就返回空串。 */
export function zhihuVideoId(url) {
  return ((url || '').match(/zvideo\/(\d+)/) || [])[1] || '';
}

const AUTO_SUBMIT = new Set(['x', 'instagram', 'youtube', 'zsz']);

/** 国内平台（含知乎）只填写，不自动点发布。没写进 manual 也一样。 */
export function waitsForUser(id, manual = []) {
  return manual.includes(id) || !AUTO_SUBMIT.has(id);
}

/** 从 /api/v4/me 或包在 member 里的资料读出粉丝数。 */
export function zhihuFollowerCount(me) {
  if (!me || typeof me !== 'object') return null;
  const n = me.follower_count ?? me.followers_count ?? (me.member && me.member.follower_count);
  return Number.isFinite(n) ? n : null;
}
