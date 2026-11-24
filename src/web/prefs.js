// 偏好页。能改什么、默认值和范围来自 /api/prefs（背后是 src/prefs.json 和 config.json）。
let P = null, prefsDirty = false;

function dress(raw) {
  const ids = raw.platforms.map((p) => p.id);
  const site = raw.site;
  return {
    ...raw,
    keepAlive: (raw.keepAlive || []).filter((id) => ids.includes(id)),
    siteForm: {
      name: site?.name || '',
      base: site?.base || '',
      adminPath: site?.adminPath || '',
      coursesApi: site?.coursesApi || '',
      dashboardApi: site?.dashboardApi || '',
      coursePath: site?.coursePath || '',
      logo: !!site?.logo,
    },
    feishuDraft: '',
    feishuClear: false,
    avatarFile: '',
    logoFile: '',
    avatarPreview: '',
    logoPreview: '',
    rev: Date.now(),
  };
}

function readPrefsForm() {
  const form = document.querySelector('#prefs-form');
  if (!form || !P) return;
  P.owner = form.owner.value;
  P.manual = P.platforms.map((p) => p.id).filter((id) => form.querySelector(`[name="mode-${id}"]:checked`)?.value === 'manual');
  P.keepAlive = [...form.querySelectorAll('[name=keep]:checked')].map((el) => el.value);
  P.keepAliveMinutes = Number(form.keepAliveMinutes.value);
  P.sampleHours = Number(form.sampleHours.value);
  for (const f of P.siteFields) P.siteForm[f.key] = form.elements[f.key].value;
  P.feishuDraft = form.feishuWebhook.value.trim();
  P.feishuClear = form.feishuClear.checked;
}

function prefsPayload() {
  const base = P.siteForm.base.trim();
  const body = {
    owner: P.owner.trim(),
    manual: P.manual,
    keepAlive: P.keepAlive,
    keepAliveMinutes: P.keepAliveMinutes,
    sampleHours: P.sampleHours,
    site: base ? {
      name: P.siteForm.name.trim(),
      base,
      adminPath: P.siteForm.adminPath.trim(),
      coursesApi: P.siteForm.coursesApi.trim(),
      dashboardApi: P.siteForm.dashboardApi.trim(),
      coursePath: P.siteForm.coursePath.trim(),
    } : null,
  };
  if (P.feishuClear) body.feishuClear = true;
  else if (P.feishuDraft) body.feishuWebhook = P.feishuDraft;
  if (P.avatarFile) body.avatar = P.avatarFile;
  if (body.site && P.logoFile) body.siteLogo = P.logoFile;
  return body;
}

function prefsHtml() {
  const lim = P.limits;
  const manual = new Set(P.manual);
  const keep = new Set(P.keepAlive);
  const av = P.avatarPreview || (P.avatar ? `/avatar?t=${P.rev}` : '');
  const logoUrl = P.logoPreview || (P.siteForm.logo ? `/site-logo?t=${P.rev}` : '');
  const fields = P.siteFields.map((f) => `<label class="fld">${f.label}<input name="${f.key}" type="text" value="${esc(P.siteForm[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false"></label>`).join('');
  const modes = P.platforms.map((p) => `<div class="prow">${logo(p.id)}<b>${esc(p.name)}</b><span class="mode"><label><input type="radio" name="mode-${p.id}" value="auto" ${manual.has(p.id) ? '' : 'checked'}>自动提交</label><label><input type="radio" name="mode-${p.id}" value="manual" ${manual.has(p.id) ? 'checked' : ''}>等你点发布</label><label><input type="checkbox" name="keep" value="${p.id}" ${keep.has(p.id) ? 'checked' : ''}>保活</label></span></div>`).join('');
  const cur = O.episodes[0];
  const tasks = cur ? cur.tasks : [];
  const rows = P.platforms.map((p) => {
    const t = tasks.find((x) => x.platform === p.id);
    const login = (O.health.login || {})[p.id];
    const word = login === 'ok' ? '已登录' : login === 'out' ? '掉线' : '还没有';
    const u = t && safeUrl(t.url);
    return `<tr><td>${logo(p.id)}${esc(p.name)}</td><td>${word}</td><td>${t ? chip(t) : '<span class="st-chip planned"><i>○</i>还没有</span>'}</td><td>${u ? `<a href="${u}" target="_blank" rel="noopener">打开 ↗</a>` : ''}</td></tr>`;
  }).join('');
  const pfSec = (id, t, note = '') => `<div class="sec" id="${id}"><h2>${t}</h2><span class="note">${note}</span></div>`;
  const nav = [['pf-owner', '头像与署名'], ['pf-platforms', '平台'], ['pf-pace', '节奏'], ['pf-site', '自有站点'], ['pf-feishu', '飞书通知'], ['pf-links', '链接状态']];
  return `<div class="prefs-page"><nav class="prefs-nav" aria-label="偏好">${nav.map(([id, name], i) => `<a href="#/prefs" data-pf="${id}" class="${i ? '' : 'on'}">${name}</a>`).join('')}</nav><div class="prefs"><div class="h1">偏好</div><p class="lead">头像、署名、哪些平台自动发、节奏、自有站点、飞书通知。保存后写入 config.json，这次守护进程马上用新的。平台名单和默认值在 <code>src/prefs.json</code>。</p>
  <form id="prefs-form">
    ${pfSec('pf-owner', '头像与署名', '小组件上显示')}
    <div class="panel pf">
      <div class="pf-ava">${av ? `<img src="${av}" alt="">` : '<div class="pf-ph">无</div>'}
        <div><label class="fld">署名<input name="owner" type="text" maxlength="${lim.owner}" value="${esc(P.owner)}" placeholder="你的名字"></label>
        <label class="btn" style="margin-top:10px">更换头像<input class="pf-file" type="file" name="avatar" accept="image/jpeg,image/png,image/webp"></label></div>
      </div>
    </div>
    ${pfSec('pf-platforms', '平台', '不在「等你点发布」里的，填完会自动提交')}
    <div class="panel">${modes}</div>
    ${pfSec('pf-pace', '节奏', `保活 ${lim.keepAliveMinutes[0]}–${lim.keepAliveMinutes[1]} 分钟，采样 ${lim.sampleHours[0]}–${lim.sampleHours[1]} 小时`)}
    <div class="panel pf-grid">
      <label class="fld">保活间隔（分钟）<input name="keepAliveMinutes" type="number" min="${lim.keepAliveMinutes[0]}" max="${lim.keepAliveMinutes[1]}" step="1" value="${esc(P.keepAliveMinutes)}"></label>
      <label class="fld">流量采样间隔（小时）<input name="sampleHours" type="number" min="${lim.sampleHours[0]}" max="${lim.sampleHours[1]}" step="1" value="${esc(P.sampleHours)}"></label>
    </div>
    ${pfSec('pf-site', '自有站点', '地址留空就是关掉。图标给网页上的站点标记用')}
    <div class="panel">
      <div class="pf-grid">${fields}</div>
      <div class="pf-ava" style="margin-top:14px">${logoUrl ? `<img src="${logoUrl}" alt="">` : '<div class="pf-ph">无</div>'}<label class="btn">站点图标<input class="pf-file" type="file" name="siteLogo" accept="image/jpeg,image/png,image/webp"></label></div>
    </div>
    ${pfSec('pf-feishu', '飞书通知', P.feishu.on ? `已配置，末四位 ${esc(P.feishu.tail)}。填写新的 https 地址才会替换` : '还没有配置')}
    <div class="panel pf">
      <label class="fld">新的 webhook<input name="feishuWebhook" type="url" placeholder="https://" spellcheck="false" autocomplete="off" value="${esc(P.feishuDraft)}"></label>
      <label class="opt"><input name="feishuClear" type="checkbox" ${P.feishuClear ? 'checked' : ''}>清除飞书通知</label>
    </div>
    <div class="btns" style="margin-top:18px"><button class="btn pri" type="submit">保存</button></div>
  </form>
  ${pfSec('pf-links', '链接状态', cur ? `最新一期「${esc(cur.nick)}」` : '还没有登记的期数')}
  <div class="panel"><div class="tw"><table><thead><tr><th>平台</th><th>登录</th><th>这一期</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="btns" style="margin-top:14px">${abtn({ type: 'doctor' }, '体检：检查各平台登录', 'pri')}${cur ? abtn({ type: 'sync', id: cur.id }, '取链接、对状态') : ''}</div>
  </div></div></div>`;
}

async function vPrefs() {
  if (!P || !prefsDirty) P = dress(await api('/api/prefs'));
  return prefsHtml();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('图片读不了'));
    r.readAsDataURL(file);
  });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('[data-pf]');
  if (!a) return;
  const el = document.getElementById(a.dataset.pf);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
addEventListener('scroll', () => {
  const nav = document.querySelector('.prefs-nav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('[data-pf]')];
  let current = links[0];
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) current = links[links.length - 1];
  else for (const a of links) {
    const el = document.getElementById(a.dataset.pf);
    if (el && el.getBoundingClientRect().top <= 96) current = a;
  }
  for (const a of links) a.classList.toggle('on', a === current);
}, { passive: true });
document.addEventListener('input', (e) => {
  if (!e.target.closest || !e.target.closest('#prefs-form') || e.target.type === 'file') return;
  prefsDirty = true;
  readPrefsForm();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#prefs-form')) return;
  if (t.type !== 'file') { prefsDirty = true; readPrefsForm(); return; }
  const f = t.files && t.files[0];
  if (!f) return;
  if (f.size > ((P && P.limits && P.limits.imageBytes) || 2 * 1024 * 1024)) { toast('图片超过 2MB'); t.value = ''; return; }
  try {
    const url = await readFileAsDataUrl(f);
    const b64 = url.split(',')[1] || '';
    if (t.name === 'avatar') { P.avatarFile = b64; P.avatarPreview = url; applyAppIcon(url); }
    else { P.logoFile = b64; P.logoPreview = url; }
    prefsDirty = true;
    readPrefsForm();
    render();
  } catch (err) { toast(err.message); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'prefs-form') return;
  e.preventDefault();
  readPrefsForm();
  if (P.feishuClear && P.feishuDraft) { toast('不能同时清除和填写新的飞书地址'); return; }
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const r = await fetch('/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prefsPayload()) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '没保存');
    P = dress(j);
    prefsDirty = false;
    if (P.avatar) applyAppIcon('/icon?t=' + P.rev);
    toast('已保存');
    render();
  } catch (err) { toast(err.message); btn.disabled = false; }
});
