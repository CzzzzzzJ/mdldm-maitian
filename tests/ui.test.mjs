import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
function context(file) {
  let source = fs.readFileSync(new URL(file, root), 'utf8');
  if (file.endsWith('.html')) source = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n').replace(/^load\(\); setInterval[^\n]*/m, '');
  const events = {};
  const element = { style: {}, dataset: {}, classList: { add() {} }, append() {}, remove() {} };
  const ctx = vm.createContext({ document: { querySelector: () => element, createElement: () => element, addEventListener(type, handler) { (events[type] ||= []).push(handler); }, body: element }, location: { hash: '#/system', search: '' }, URLSearchParams, matchMedia: () => ({ matches: false }), addEventListener() {}, setInterval() {}, clearInterval() {}, setTimeout() {}, console });
  if (file.endsWith('pages.html')) vm.runInContext(fs.readFileSync(new URL('src/web/mt.js', root), 'utf8'), ctx);
  vm.runInContext(source, ctx);
  ctx.events = events;
  return ctx;
}
for (const file of ['src/web/mt.js', 'src/web/board.html']) {
  test(`${file}: enabled targets replace old platform list and can be re-enabled`, () => {
    const ctx = context(file);
    assert.equal(vm.runInContext('typeof applyTargets', ctx), 'function');
    ctx.overview = { siteOn: false, targets: [{ id: 'bilibili', platform: 'bilibili', name: '主账号' }, { id: 'bilibili@a', platform: 'bilibili', name: '副账号' }] };
    vm.runInContext('applyTargets(overview)', ctx);
    assert.equal(vm.runInContext('JSON.stringify(PL)', ctx), '["bilibili","bilibili@a"]');
    assert.equal(vm.runInContext('PN["bilibili@a"]', ctx), '副账号');
    assert.ok(vm.runInContext('logo("bilibili@a").includes("<svg")', ctx));
    assert.equal(vm.runInContext('platformOf("bilibili@a")', ctx), 'bilibili');
    ctx.overview = { siteOn: false, targets: [{ id: 'douyin', platform: 'douyin', name: '抖音' }] };
    vm.runInContext('applyTargets(overview)', ctx);
    assert.equal(vm.runInContext('JSON.stringify(PL)', ctx), '["douyin"]');
  });
}
test('settings escape account names and expose labelled controls without asking for profile paths', () => {
  const ctx = context('src/web/pages.html');
  assert.equal(vm.runInContext('typeof settingsHTML', ctx), 'function');
  vm.runInContext('O = { actions: [] }', ctx);
  ctx.settings = { driver: 'direct', platforms: [{ id: 'bilibili', name: 'B站', enabled: true, available: true }], bilibiliAccounts: [{ id: 'default', name: '\"><img src=x onerror=alert(1)>', uid: '123', enabled: true }] };
  const html = vm.runInContext('settingsHTML(settings)', ctx);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('aria-label='));
  assert.ok(!html.includes('chromeProfile'));
  assert.ok(!html.includes('data-remove-account="0"'));
});
test('settings collection preserves account identity and disabled flags', () => {
  const ctx = context('src/web/pages.html');
  assert.equal(vm.runInContext('typeof readSettings', ctx), 'function');
  ctx.form = { querySelectorAll(selector) {
    if (selector === '[name="platform"]:checked') return [{ value: 'bilibili' }];
    if (selector === '[data-account]') return [{ dataset: { id: 'default', uid: '123' }, querySelector(selector) { return selector === '[name="accountName"]' ? { value: '主账号' } : { checked: false }; } }];
    throw new Error(selector);
  } };
  assert.equal(vm.runInContext('JSON.stringify(readSettings(form))', ctx), '{"enabledPlatforms":["bilibili"],"bilibiliAccounts":[{"id":"default","name":"主账号","uid":"123","enabled":false}]}');
});
test('traffic tables render user account names as text', () => {
  const ctx = context('src/web/pages.html');
  ctx.overview = { siteOn: false, targets: [{ id: 'bilibili@a', platform: 'bilibili', name: '<img src=x onerror=alert(1)>' }], actions: [], samples: [], followers: [], episodes: [{ id: 'e', name: '测试', nick: '测试', episode: 1, views: 100, inter: 0, covers: [], createdAt: '2026-11-17', tasks: [{ platform: 'bilibili@a', state: 'published', url: '', m: { views: 100 } }] }] };
  vm.runInContext('O = overview; applyTargets(O)', ctx);
  const html = vm.runInContext('vTraffic()', ctx);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});
test('account traffic renders collected zero-view works, account errors, and real follower data without projects', () => {
  const ctx = context('src/web/pages.html');
  ctx.overview = { siteOn: false, targets: [{ id: 'bilibili', name: '主账号' }], actions: [], samples: [], followers: [], episodes: [], accountTraffic: {
    statuses: [{id:'bilibili',count:1,syncedAt:'2026-11-17T09:00:00Z',error:'<script>登录失败</script>'}], history: [], videos: [{platform:'bilibili',id:'BV1',title:'<img src=x>零播放作品',url:'https://www.bilibili.com/video/BV1',publishedAt:null,views:0,likes:0,comments:null,favorites:null,shares:null}]
  } };
  vm.runInContext('O=overview; applyTargets(O); F={bilibili:{"2026-11-17":43571}}', ctx);
  const html = vm.runInContext('vTraffic()', ctx);
  assert.ok(html.includes('零播放作品')); assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('43,571')); assert.ok(html.includes('登录失败')); assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('还没采到流量')); assert.ok(html.includes('https://www.bilibili.com/video/BV1'));
});
test('traffic does not hide registered projects with a collected zero-view metric', () => {
  const ctx = context('src/web/pages.html');
  ctx.overview = { siteOn:false,targets:[{id:'bilibili',name:'B站'}],actions:[],samples:[],followers:[],episodes:[{id:'e',name:'零播放',nick:'零播放',views:0,inter:0,covers:[],createdAt:'2026-11-17',tasks:[{platform:'bilibili',state:'published',m:{views:0}}]}] };
  vm.runInContext('O=overview; applyTargets(O)',ctx);
  const html = vm.runInContext('vTraffic()',ctx);
  assert.ok(html.includes('零播放')); assert.ok(!html.includes('还没采到流量'));
});
test('turning all platforms off leaves a route back to settings', () => {
  const ctx = context('src/web/pages.html');
  ctx.overview = { targets: [], siteOn: false };
  vm.runInContext('applyTargets(overview)', ctx);
  assert.ok(vm.runInContext('vTraffic().includes(\'href="#/system"\')', ctx));
});
test('account login and check controls do not submit the settings form', () => {
  const ctx = context('src/web/pages.html');
  vm.runInContext('O = { actions: [] }', ctx);
  ctx.settings = { driver: 'direct', platforms: [], bilibiliAccounts: [{ id: 'default', name: '主账号', uid: '', enabled: true }] };
  const html = vm.runInContext('settingsHTML(settings)', ctx);
  const actions = [...html.matchAll(/<button\b[^>]*data-act=[^>]*>/g)];
  assert.equal(actions.length, 2);
  for (const [button] of actions) assert.match(button, /type="button"/);
});
test('refresh shows a newly bound UID while preserving an unsaved settings form', async () => {
  const ctx = context('src/web/pages.html');
  const app = { innerHTML: '' };
  const overview = { targets: [], siteOn: false, followers: [], episodes: [], actions: [], feed: [], health: { login: {}, nas: true, chrome: true, doctorDay: '', metricsDay: '' } };
  const settings = { driver: 'direct', platforms: [], enabledPlatforms: [], bilibiliAccounts: [{id: 'default', name: '主账号', uid: '123', enabled: true}] };
  ctx.document.querySelector = () => app;
  ctx.fetch = async url => ({ok: true, json: async () => ({
    '/api/overview': overview, '/api/settings': settings, '/api/integrations': { feishu: {}, site: {} },
  })[url]});
  await vm.runInContext('load()', ctx);
  assert.equal(vm.runInContext('S.bilibiliAccounts[0].uid', ctx), '123');
  assert.ok(app.innerHTML.includes('UID 123'));
  vm.runInContext('settingsDirty = true; S.bilibiliAccounts[0].name = "未保存名称"', ctx);
  app.innerHTML = 'unsaved-form';
  await vm.runInContext('load()', ctx);
  assert.equal(app.innerHTML, 'unsaved-form');
  assert.equal(vm.runInContext('S.bilibiliAccounts[0].name', ctx), '未保存名称');
});
