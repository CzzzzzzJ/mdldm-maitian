import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = file => fs.readFileSync(new URL('../src/web/' + file, import.meta.url), 'utf8');
const page = source('pages.html').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^load\(\); setInterval[^\n]*/m, '');
const overview = {
  health: { nas: true, chrome: true, login: {}, platforms: [
    { id: 'bilibili', name: 'B站 · 主号', state: 'ok', day: '2026/11/20' },
    { id: 'bilibili@second', name: '<副号>', reason: '<待检查>' },
    { id: 'xhs', disabled: true },
  ] },
  siteOn: false, episodes: [], followers: [], actions: [], feed: [],
};
const settings = {
  bilibiliAccounts: [{ id: 'default', name: '<主号>', uid: '123', enabled: true }],
};
const secret = 'https://example.invalid/private-hook';
function fixture(getSettings = true, overviewData = overview) {
  const elements = new Map([['#app', {}]]);
  const listeners = {}, calls = [];
  const ctx = vm.createContext({
    location: { hash: '#/system', search: '' }, setInterval() {}, clearInterval() {}, setTimeout() {}, addEventListener() {},
    document: {
      createElement: () => ({}), querySelector: s => elements.get(s) || null,
      addEventListener(type, cb) { (listeners[type] ||= []).push(cb); }, body: { append() {} },
    },
    confirm: () => true,
    fetch: async (url, options) => {
      calls.push([url, options ? JSON.parse(options.body) : null]);
      const responses = {
        '/api/overview': overviewData, '/api/bilibili-accounts': getSettings ? settings : null,
        '/api/integrations': { feishu: { webhook: secret, login: true }, site: {} },
        '/api/integrations/feishu': { feishu: { configured: true, login: true } },
        '/api/platform-toggle': { ok: true }, '/api/action': { ok: true },
      };
      return { ok: responses[url] != null, status: 404, json: async () => responses[url] };
    },
  });
  vm.runInContext(source('mt.js'), ctx);
  vm.runInContext(page, ctx);
  return { calls, elements, listeners, run: js => vm.runInContext(js, ctx) };
}
test('System renders named account controls and keeps secrets out of rendered HTML', async () => {
  const { elements, run } = fixture();
  await run('load()');
  const html = elements.get('#app').innerHTML;
  assert.match(html, /1 个账号待检查/);
  assert.match(html, /最近检查 2026\/11\/20/);
  assert.match(html, /aria-label="检查B站 · 主号"/);
  assert.doesNotMatch(html, /aria-label="检查&lt;副号&gt;"/);
  assert.match(html, /&lt;待检查&gt;/);
  assert.match(html, /<button type="button"[^>]*data-act=/);
  assert.match(html, /UID 123/);
  assert.doesNotMatch(html, /<待检查>|<副号>|<主号>|private-hook|data-remove-account="0"/);
  assert.doesNotMatch(html, /同步知识站数据/);
});
test('System puts the single enabled site sync action under 收入来源, outside 平台', async () => {
  const { calls, elements, listeners, run } = fixture(true, { ...overview, siteOn: true, siteName: '课程站' });
  await run('load()');
  const html = elements.get('#app').innerHTML;
  const actions = [...html.matchAll(/data-act='([^']+)'[^>]*>同步课程站数据<\/button>/g)];
  assert.equal(actions.length, 1);
  assert.equal([...html.matchAll(/&quot;type&quot;:&quot;board&quot;/g)].length, 1);
  assert.ok(html.indexOf('<h2>平台</h2>') < html.indexOf('<h2>集成</h2>'));
  assert.ok(html.indexOf('<h2>集成</h2>') < html.indexOf('<h2>收入来源</h2>'));
  assert.match(html.slice(html.indexOf('<h2>收入来源</h2>')), /同步课程站数据/);
  const button = { dataset: { act: actions[0][1].replaceAll('&quot;', '"') } };
  await listeners.click[0]({ target: { closest: s => s === '[data-act]' ? button : null } });
  assert.deepEqual(calls.filter(([url]) => url === '/api/action'), [['/api/action', { type: 'board' }]]);
});

test('System omits the revenue sync section when site sync is disabled or unspecified', async () => {
  const { siteOn, ...missingSiteState } = overview;
  for (const data of [overview, missingSiteState]) {
    const { elements, run } = fixture(true, data);
    await run('load()');
    const html = elements.get('#app').innerHTML;
    assert.doesNotMatch(html, /收入来源|&quot;type&quot;:&quot;board&quot;/);
    assert.match(html, /<h3>知识站<\/h3>/);
  }
});

test('System remains usable on a legacy server without the settings API', async () => {
  const { elements, run } = fixture(false);
  await run('load()');
  const html = elements.get('#app').innerHTML;
  assert.match(html, /全部检查/);
  assert.match(html, /已配置，留空沿用原地址/);
  assert.doesNotMatch(html, /settings-form|private-hook/);
});
test('Feishu save preserves a legacy webhook and omits it with the redacted API', async () => {
  const { elements, calls, run } = fixture();
  await run('load()');
  elements.set('#fs-webhook', { value: '' });
  await run('saveFeishu(true)');
  await run('saveFeishu(true)');
  assert.deepEqual(calls.slice(-2), [
    ['/api/integrations/feishu', { webhook: secret, login: true }],
    ['/api/integrations/feishu', { login: true }],
  ]);
});
test('polling preserves unsaved edits and dirty settings block platform toggles', async () => {
  const { elements, calls, listeners, run } = fixture();
  await run('load()');
  run('settingsDirty = true');
  elements.set('#settings-form', {});
  elements.get('#app').innerHTML = 'unsaved form';
  await run('load()');
  assert.equal(elements.get('#app').innerHTML, 'unsaved form');
  const toggle = { dataset: { act: JSON.stringify({ type: 'toggle-platform', platform: 'bilibili', on: false }) } };
  await listeners.click[0]({ target: { closest: s => s === '[data-act]' ? toggle : null } });
  assert.ok(!calls.some(([url]) => url === '/api/platform-toggle'));
});

test('account edits use one atomic replacement request and no publisher platform writes', async () => {
  const { calls, elements, listeners, run } = fixture();
  await run('load()');
  elements.set('#settings-message', { textContent: '' });
  const button = {};
  const row = {
    dataset: { id: 'default', uid: '123' },
    querySelector: selector => selector === '[name="accountName"]' ? { value: ' 主号 ' } : { checked: false },
  };
  const form = { id: 'settings-form', querySelector: () => button, querySelectorAll: () => [row] };
  await listeners.submit[0]({ target: form, preventDefault() {} });
  assert.deepEqual(calls.find(([, payload]) => payload?.action === 'replace'), [
    '/api/bilibili-accounts', { action: 'replace', bilibiliAccounts: [{ id: 'default', name: '主号', uid: '123', enabled: false }] },
  ]);
  assert.ok(!calls.some(([url]) => url === '/api/platform-toggle'));
  assert.equal(button.disabled, false);
});
