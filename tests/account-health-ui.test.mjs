import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = file => fs.readFileSync(new URL('../src/web/' + file, import.meta.url), 'utf8');
const inline = file => source(file).match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^load\(\); setInterval[^\n]*/m, '');
const second = 'bilibili@' + 'second';

function view(file = 'pages.html') {
  const elements = new Map([['#app', {}], ['#screen', {}]]), listeners = {}, calls = [];
  const ctx = vm.createContext({
    URLSearchParams, location: { hash: '#/system', search: '' },
    innerWidth: 1200, matchMedia: () => ({ matches: false }), setInterval() {}, clearInterval() {}, setTimeout() {}, addEventListener() {},
    document: {
      createElement: () => ({}), querySelector: s => elements.get(s) || null, querySelectorAll: () => [],
      addEventListener(type, cb) { (listeners[type] ||= []).push(cb); }, body: { append() {} },
    },
    confirm: () => true,
    fetch: async (url, opts) => {
      calls.push([url, JSON.parse(opts.body)]);
      const json = url.endsWith('feishu') ? { feishu: { configured: true, login: true } }
        : url.endsWith('/site') ? { site: { enabled: false } } : { ok: true };
      return { ok: true, json: async () => json };
    },
  });
  if (file === 'pages.html') vm.runInContext(source('mt.js'), ctx);
  vm.runInContext(inline(file), ctx);
  return { ctx, elements, calls, listeners, run: text => vm.runInContext(text, ctx) };
}

function data() {
  const platforms = [
    { id: 'bilibili', name: 'B站 · 主号', disabled: false, state: 'ok' },
    { id: second, name: 'B站 · <副号>', disabled: false, state: 'out', reason: '<掉线>' },
    { id: 'xhs', name: '小红书', disabled: true, state: 'out' },
  ];
  return {
    health: { login: {}, platforms, nas: true, chrome: true }, episodes: [], actions: [], feed: [], followers: [],
    targets: platforms.slice(0, 2), siteOn: true, siteName: '示例站点',
    site: { days: [], channels: [] },
  };
}

test('platform table addresses each Bilibili account, counts enabled accounts', () => {
  const { ctx, run } = view();
  ctx.overview = data();
  run("O=overview;applyTargets(O);I={feishu:{configured:true},site:{enabled:true,name:'示例站点'}}");
  const html = run('vSystem()');
  assert.match(html, /1 家掉线/);
  assert.match(html, /aria-label="检查B站 · &lt;副号&gt;"/);
  assert.doesNotMatch(html, /<掉线>|<副号>|只能从命令行/);
  const actions = Array.from(html.matchAll(/data-act='([^']+)'/g), m => JSON.parse(m[1].replaceAll('&quot;', '"')));
  const only = id => actions.filter(a => a.platform === id).map(a => a.type);
  for (const id of ['bilibili', second]) assert.deepEqual(only(id), ['doctor', 'login', 'toggle-platform']);
  assert.deepEqual(only('xhs'), ['toggle-platform']);
});

test('checking the primary account does not mark an untested secondary account healthy', () => {
  const sample = data();
  sample.health.platforms[1].state = '';
  sample.health.doctorDay = '2026/11/19';
  for (const file of ['board.html', 'pages.html']) {
    const { ctx, run } = view(file);
    ctx.overview = sample;
    assert.match(run('loginLight(overview.health)[1]'), /1 个账号待检查/);
    if (file === 'pages.html') {
      run("O=overview;I={feishu:{},site:{enabled:true}}");
      assert.match(run('vSystem()'), /点击「检查」/);
      sample.health.platforms[0].day = '2026/11/20';
      assert.match(run('vSystem()'), /最近检查 2026\/11\/20/);
    }
  }
});

test('dashboard keeps both Bilibili cards and shares its offline count with the system page', async () => {
  const { ctx, run, elements } = view('board.html');
  ctx.overview = data();
  ctx.fetch = async () => ({ ok: true, json: async () => ctx.overview });
  await run('load()');
  const html = elements.get('#screen').innerHTML;
  assert.match(html, /平台登录 1 家掉线/);
  assert.match(html, /class="cards"[\s\S]*B站 · 主号[\s\S]*B站 · &lt;副号&gt;[\s\S]*转化详情/);
  assert.doesNotMatch(html, /href="\/p#\/publish">发布/);
});

test('switching one account or the site integration sends only its intended change', async () => {
  const { ctx, run, elements, calls, listeners } = view();
  ctx.overview = data();
  run("O=overview;I={feishu:{configured:true},site:{enabled:true,base:'https://example.invalid'}};load=async()=>{}");
  const toggle = { dataset: { act: JSON.stringify({ type: 'toggle-platform', platform: second, on: false }) } };
  await listeners.click[0]({ target: { closest: s => s === '[data-act]' ? toggle : null } });
  const siteSwitch = { id: 'site-on', checked: false, closest() { return null; } };
  elements.set('#site-on', siteSwitch);
  for (const listener of listeners.change) await listener({ target: siteSwitch });
  elements.set('#fs-webhook', { value: '' });
  await run('saveFeishu(true)');
  assert.deepEqual(calls, [
    ['/api/platform-toggle', { platform: second, on: false }],
    ['/api/integrations/site', { enabled: false }],
    ['/api/integrations/feishu', { login: true }],
  ]);
  const prior = calls.length;
  run('settingsDirty=true');
  await listeners.click[0]({ target: { closest: s => s === '[data-act]' ? toggle : null } });
  assert.equal(calls.length, prior);
});
