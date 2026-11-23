// src/make-publish.local.mjs —— 本机私有扩展，不提交。
// make-publish.mjs:110-113 发现这个文件就调用 extend()，用来把「## 十一、公众号」节
// 变成 publish.json 里的 platforms.wechat。核心 make-publish.mjs 零改动。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 纯文本正文 → 公众号能接受的 HTML（公众号只认内联样式，不认 class/style 表）
// 规则：空行分段；连续以「·/•/-」开头的行合成 <ul>；单段内换行用 <br>
export function textToHtml(text) {
  const paras = String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const body = paras.map((p) => {
    const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(l => /^[·•\-]\s*/.test(l))) {
      return '<ul>' + lines.map(l => `<li>${esc(l.replace(/^[·•\-]\s*/, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('\n');
  // 公众号正文的空段落用 <p><br></p> 撑开，手机端才有呼吸感
  return `<section style="font-size:16px;line-height:1.75;color:#333;">\n${body}\n</section>`;
}

// 工程目录：从原始 argv 里取第二个位置参数（make-publish.mjs 内部用的是 splice 过的副本，argv 本身没变）
function projectDir() {
  const raw = process.argv.slice(2);
  const pos = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith('--')) { i++; continue; }
    pos.push(raw[i]);
  }
  return pos[1] ? path.resolve(pos[1]) : process.cwd();
}

export function extend({ out, sec, field }) {
  const s = sec('公众号');
  if (!s) return;

  const title = (field(s, '标题') || '').trim();
  const digest = (field(s, '摘要') || '').trim();
  // 正文两种写法：**HTML路径：** 指向 gzh-design 产出的 HTML 文件；或直接写 **正文：** 纯文本
  const htmlRel = (field(s, 'HTML路径') || '').trim();
  const sourceUrl = (field(s, '阅读原文') || '').trim();   // 公众号「阅读原文」跳转，外链只能放这里
  const plain = field(s, '正文');

  let contentHtml = '';
  if (htmlRel) {
    const p = path.isAbsolute(htmlRel) ? htmlRel : path.join(projectDir(), htmlRel);
    if (!existsSync(p)) {
      console.log(`⚠️  公众号：找不到 HTML 文件 ${p}`);
    } else {
      contentHtml = readFileSync(p, 'utf8');
    }
  }
  const plainText = plain || (contentHtml ? contentHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');
  if (!contentHtml && plainText) contentHtml = textToHtml(plainText);

  out.platforms.wechat = {
    ...(title ? { title } : {}),
    ...(digest ? { digest } : {}),
    body: plainText,
    content: contentHtml,
    ...(sourceUrl ? { sourceUrl } : {}),
    // 公众号首图 2.35:1，由适配器从 16:9 居中裁成 900×383
    covers: out.covers['16x9'] ? ['16x9'] : (out.covers['4x3'] ? ['4x3'] : []),
  };
}
