// 扩展点：额外平台的校验规则（字段与字数上限），格式同 lib/bundle.js 里的 PLATFORMS。
// 这个文件不能依赖 chrome.*，命令行校验也会用到。
// wechat 的限制来自公众号后台：标题 ≤64 字、摘要 ≤120 字、正文去标签后 ≤2 万字。
// 校验用 body（纯文本），content 是发给 operate_appmsg 的 HTML，不参与字数校验。
export const specs = {
  wechat: { name: '公众号', fields: { title: [1, 64], digest: [0, 120], body: [1, 20000] }, links: true },
};
