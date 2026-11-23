import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = file => fs.readFileSync(new URL('../src/web/' + file, import.meta.url), 'utf8');
const page = source('pages.html').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^load\(\); setInterval[^\n]*/m, '');
const overview = {
  health: { nas: true, chrome: true, login: {}, platforms: [{ id:'bilibili', name:'B站', state:'ok' }], accountRows: [
    { id: 'bilibili', platform:'bilibili', accountId:'default', name: 'B站 · 主号', state: 'ok', day: '2026/11/20' },
    { id: 'bilibili@second', platform:'bilibili', accountId:'second', name: '<副号>', reason: '<待检查>' },
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
  assert.match(html, /aria-label="检查&lt;副号&gt;"/);
  assert.match(html, /aria-label="去登录 · &lt;副号&gt;"/);
  assert.match(html, /aria-label="停用&lt;副号&gt;"/);
  assert.match(html, /&lt;待检查&gt;/);
  assert.match(html, /<button type="button"[^>]*data-act=/);
  assert.match(html, /管理B站账号/);
  assert.doesNotMatch(html, /启用账号|settings-form/);
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
  const {accountRows, ...health} = overview.health;
  const { elements, run } = fixture(false, { ...overview, health });
  await run('load()');
  const html = elements.get('#app').innerHTML;
  assert.match(html, /全部检查/);
  assert.match(html, /已配置，留空沿用原地址/);
  assert.doesNotMatch(html, /settings-form|private-hook|data-manage-accounts/);
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
const clickControl = (listener, selector, control = {}) => listener({ target: { closest: s => s === selector ? control : null } });
test('account management replaces only B站 rows, preserves draft across polls and can cancel', async () => {
  const { elements, calls, listeners, run } = fixture();
  await run('load()');
  assert.ok(!calls.some(([url]) => url === '/api/bilibili-accounts'));
  await clickControl(listeners.click[0], '[data-manage-accounts]');
  const html = elements.get('#app').innerHTML;
  assert.match(html, /<form id="settings-form"/);
  assert.match(html, /value="123"[^>]+readonly/);
  assert.match(html, /aria-label="启用小红书"/);
  assert.doesNotMatch(html, /aria-label="检查B站|启用账号/);
  elements.set('#settings-form', { dataset: {} });
  elements.get('#app').innerHTML = 'unsaved';
  await run('load()');
  assert.equal(elements.get('#app').innerHTML, 'unsaved');
  await clickControl(listeners.click[0], '[data-cancel-accounts]');
  assert.doesNotMatch(elements.get('#app').innerHTML, /<form id="settings-form"/);
  assert.match(elements.get('#app').innerHTML, /aria-label="检查B站 · 主号"/);
  assert.ok(!calls.some(([,data]) => data?.action === 'replace'));
});
test('account editor saves names and UIDs with a stale-edit check, leaving toggles to platform rows', async () => {
  const { calls, elements, listeners, run } = fixture();
  await run('load()');
  await clickControl(listeners.click[0], '[data-manage-accounts]');
  elements.set('#settings-message', { textContent: '' });
  const button = {};
  const row = {
    dataset: { id: 'default' },
    querySelector: selector => ({ value: selector === '[name="accountName"]' ? '主号' : '123' }),
  };
  const form = { id: 'settings-form', dataset:{}, querySelector: () => button, querySelectorAll: () => [row] };
  await listeners.submit[0]({ target: form, preventDefault() {} });
  assert.deepEqual(calls.find(([, payload]) => payload?.action === 'replace'), [
    '/api/bilibili-accounts', { action:'replace', expectedAccounts:settings.bilibiliAccounts, bilibiliAccounts:[{ id:'default', name:'主号', uid:'123' }] },
  ]);
  assert.ok(!calls.some(([url]) => url === '/api/platform-toggle'));
  assert.equal(button.disabled, false);
});
test('rows dispatch their exact account and global commands omit the target', async () => {
  const { calls, elements, listeners, run } = fixture();
  await run('load()');
  const html = elements.get('#app').innerHTML;
  for (const label of ['检查B站 · 主号','检查&lt;副号&gt;', '去登录 · &lt;副号&gt;', '停用B站 · 主号', '停用&lt;副号&gt;', '启用小红书']) {
    const attrs = html.match(new RegExp(`aria-label="${label}"[^>]*data-act='([^']+)'`))[1];
    await clickControl(listeners.click[0], '[data-act]', { dataset:{ act:attrs.replaceAll('&quot;', '"') } });
  }
  const second = 'bilibili@second';
  assert.deepEqual(calls.filter(([url]) => ['/api/action','/api/platform-toggle'].includes(url)), [
    ['/api/action',{ type:'doctor', platform:'bilibili' }], ['/api/action',{ type:'doctor', platform:second }],
    ['/api/action',{ type:'login', platform:second }],
    ['/api/platform-toggle',{ platform:'bilibili', accountId:'default', on:false }],
    ['/api/platform-toggle',{ platform:'bilibili', accountId:'second', on:false }],
    ['/api/platform-toggle',{ platform:'xhs', on:true }],
  ]);
  assert.match(html, /data-act='\{&quot;type&quot;:&quot;doctor&quot;\}'[^>]*>全部检查/);
});

test('the whole-platform switch is separate from account toggles and preserves edits', async () => {
  const data = structuredClone(overview);
  const { calls, elements, listeners, run } = fixture(true, data);
  await run('load()');
  await clickControl(listeners.click[0], '[data-manage-accounts]');
  const form = { dataset:{}, querySelectorAll:() => [{
    dataset:{id:'default'}, querySelector:s => ({value: s.includes('accountName') ? '未保存名字' : '123'}),
  }] };
  elements.set('#settings-form', form);
  await clickControl(listeners.input[0], '#settings-form', form);
  let html = elements.get('#app').innerHTML;
  const switchButton = html.match(/data-act='([^']+)'[^>]*>停用整个B站<\/button>/);
  assert.ok(switchButton);
  for (const row of data.health.accountRows.filter(p => p.accountId)) {
    row.groupDisabled = true; row.disabled = true;
  }
  data.health.platforms[0].disabled = true; // next overview from server
  await clickControl(listeners.click[0], '[data-act]', { dataset:{act:switchButton[1].replaceAll('&quot;', '"')} });
  assert.deepEqual(calls.filter(([url]) => url === '/api/platform-toggle'), [
    ['/api/platform-toggle', {platform:'bilibili', on:false}],
  ]);
  html = elements.get('#app').innerHTML;
  assert.match(html, /启用整个B站/);
  assert.match(html, /value="未保存名字"/);
  assert.ok(!calls.some(([,payload]) => payload?.action === 'replace'));
  await clickControl(listeners.click[0], '[data-cancel-accounts]');
  html = elements.get('#app').innerHTML;
  assert.match(html, /整个B站已停用/);
  assert.doesNotMatch(html, /aria-label="启用(B站 · 主号|&lt;副号&gt;)"/);
});

test('plugin mode explains the secondary limitation without offering unusable browser actions', async () => {
  const { elements, run } = fixture(true, {...overview, driver:'plugin'});
  await run('load()');
  const html = elements.get('#app').innerHTML;
  assert.match(html, /副号体检和登录需要直连模式/);
  assert.doesNotMatch(html, /aria-label="(?:检查|去登录 · |打开后台 · )&lt;副号&gt;"/);
  assert.match(html, /aria-label="停用&lt;副号&gt;"/);
  assert.match(html, /aria-label="检查B站 · 主号"/);
});
