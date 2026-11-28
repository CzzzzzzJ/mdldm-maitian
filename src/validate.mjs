// 校验一期的 publish.json：文件齐全、各平台字段和字数、成片是 faststart。
// 字段规则来自麦田发布助手的 lib/bundle.js，跟着插件一起更新。
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { pluginDir } from './plugin.mjs';
import { isExtraManual, unsupportedNewChannels, upgradeMessage } from './publish-channels.mjs';

export async function validateProject(dir, { platforms } = {}) {
  const { validate, PLATFORMS, len } = await import(pathToFileURL(path.join(pluginDir(), 'lib', 'bundle.js')).href);
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8'));
  if (platforms) {
    const entries = Object.entries(b.platforms || {});
    const keeps = ([id]) => platforms.includes(id);
    const coverKeys = ([, p]) => Array.isArray(p?.covers) ? p.covers : [];
    const used = new Set(entries.filter(keeps).flatMap(coverKeys));
    const omitted = new Set(entries.filter(entry => !keeps(entry) && (isExtraManual(entry[0]) || platforms.every(isExtraManual))).flatMap(coverKeys));
    b.covers = Object.fromEntries(Object.entries(b.covers || {}).filter(([key]) => used.has(key) || !omitted.has(key)));
    b.platforms = Object.fromEntries(entries.filter(keeps));
  }
  const files = new Set();
  const walk = (d) => fs.readdirSync(d).forEach(n => { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : files.add(path.relative(dir, p).split(path.sep).join('/')); });
  walk(dir);
  const { errors, warnings } = validate(b, files);
  warnings.push(...unsupportedNewChannels(b.platforms, id => Object.hasOwn(PLATFORMS, id)).map(upgradeMessage));
  // moov 必须在文件头，否则小红书报「无视频流信息」、抖音不出表单
  if (b.video && files.has(b.video)) {
    try {
      const fd = fs.openSync(path.join(dir, b.video), 'r'); const buf = Buffer.alloc(1 << 16); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      let off = 0, first = null;
      while (off + 8 <= buf.length) { const size = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
        if (type === 'moov' || type === 'mdat') { first = type; break; } if (size < 8) break; off += size; }
      if (first === 'mdat') errors.push(`成片 ${b.video} 不是 faststart（moov 在文件尾），用 ffmpeg -c copy -movflags +faststart 重新封装`);
    } catch (e) { warnings.push(`成片头部读取失败：${e.message}`); }
  }
  const lines = [`工程：${b.name}（${b.id}）`];
  for (const [id, p] of Object.entries(b.platforms || {})) {
    const spec = PLATFORMS[id]; if (!spec || p.skip) continue;
    lines.push(`  ${spec.name}：${Object.keys(spec.fields).map(k => `${k} ${len(typeof p[k] === 'string' ? p[k] : '')}${Number.isFinite(spec.fields[k][1]) ? '/' + spec.fields[k][1] : ''}`).join('，')}；封面 ${(p.covers || []).join('+') || '无'}`);
  }
  warnings.forEach(w => lines.push(`⚠️  ${w}`));
  errors.forEach(e => lines.push(`❌ ${e}`));
  lines.push(errors.length ? `校验未通过：${errors.length} 个问题` : '✅ 校验通过');
  return { ok: !errors.length, errors, warnings, text: lines.join('\n') };
}

// node src/validate.mjs <工程目录>
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node src/validate.mjs <工程目录>'); process.exit(2); }
  const r = await validateProject(path.resolve(dir)); console.log(r.text); process.exit(r.ok ? 0 : 1);
}
