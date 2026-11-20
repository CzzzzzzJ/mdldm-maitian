import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-cfg-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const seed = { name: '麦田', feishuWebhook: 'https://old', web: { port: 8787, key: 'k' }, board: { url: 'B' }, rootPath: '/tmp/x' };
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify(seed, null, 2));

const { config, reloadConfig, saveSettings } = await import('../src/feishu.mjs');
const mod = await import('../src/config-admin.mjs');
const site = await import('../src/site.mjs');
const { getTargets, settingsView } = await import('../src/targets.mjs');
const testHook = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-config';

test('飞书 patch 只动飞书字段', () => {
  const r = mod.applyFeishuPatch(config, { webhook: testHook, login: true });
  assert.deepEqual(r, {configured:true, login:true});
  assert.equal(config.feishuWebhook, testHook);
  assert.equal(config.web.login, 'feishu');
  assert.equal(config.web.key, 'k');        // 其它 web 字段不动
  assert.equal(config.board.url, 'B');      // board 不动
  assert.equal(config.rootPath, '/tmp/x');
  mod.applyFeishuPatch(config, { webhook: testHook, login: false });
  assert.equal('login' in config.web, false);
});

test('开着飞书登录不能清空 webhook', () => {
  assert.throws(() => mod.applyFeishuPatch(config, { webhook: '', login: true }), /先填 webhook/);
  assert.equal(config.feishuWebhook, testHook);   // 抛错前不改配置
});

test('知识站 patch 写 enabled 并保留字段', () => {
  const s = mod.applySitePatch(config, { enabled: true, name: '站', base: 'https://a.com/', dashboardApi: '/api/admin/dashboard' });
  assert.equal(s.enabled, true);
  assert.equal(s.base, 'https://a.com/');   // 原样存，拼接在 site.mjs 里去斜杠
  mod.applySitePatch(config, { enabled: false });
  assert.equal(config.site.enabled, false);
});

test('知识站启用时必须有站点地址', () => {
  assert.throws(() => mod.applySitePatch(config, { enabled: true, base: '' }), /先填站点地址/);
  // 停用可以空着
  const s = mod.applySitePatch(config, { enabled: false, base: '' });
  assert.equal(s.enabled, false);
  assert.equal(s.base, '');
});

test('飞书保存从锁内重读磁盘，保护未知配置、备份与热更新状态', () => {
  const target = process.env.MAITIAN_CONFIG;
  const previous = { ...seed, custom: { value: 2 }, web: { key: 'kept', loginMode: 'custom' } };
  fs.writeFileSync(target, JSON.stringify(previous));
  const before = fs.readFileSync(target);
  assert.deepEqual(mod.saveFeishu({webhook:testHook, login:true}), {configured:true, login:true});
  assert.deepEqual(config.custom, previous.custom);
  assert.equal(config.web.key, 'kept'); assert.equal(config.web.loginMode, 'custom');
  assert.deepEqual(fs.readFileSync(target + '.bak'), before);
  assert.equal(fs.statSync(target + '.bak').mode & 0o777, 0o600);
  mod.saveFeishu({login:false}); assert.equal(config.feishuWebhook, testHook);
  assert.equal(config.web.login, undefined);
  assert.throws(() => mod.saveFeishu({webhook:'https://unrelated.invalid/token'}), /webhook/);
  const current = fs.readFileSync(target), backup = fs.readFileSync(target + '.bak');
  fs.writeFileSync(target + '.lock', 'writer');
  try { assert.throws(() => mod.saveFeishu({webhook:''}), /另一个任务/); }
  finally { fs.unlinkSync(target + '.lock'); }
  assert.deepEqual(fs.readFileSync(target), current); assert.deepEqual(fs.readFileSync(target + '.bak'), backup);
  assert.equal(config.feishuWebhook, testHook);
});

test('单账号行仅改变该账号；有副号时关闭总开关不能从行打开其他账号', () => {
  const cfg={enabledPlatforms:['bilibili','douyin'], bilibiliAccounts:[{id:'default',name:'主号'},{id:'second',name:'副号',uid:'132',privateField:'kept'}]};
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify(cfg)); reloadConfig();
  const disabled=mod.setPlatformEnabled('bilibili',false).disabled;
  assert.ok(disabled.includes('bilibili')); assert.ok(!disabled.includes('bilibili@second'));
  assert.deepEqual(getTargets(config).map(t=>t.id),['bilibili@second','douyin']);
  mod.setPlatformEnabled('bilibili',true); mod.setPlatformEnabled('bilibili@second',false);
  assert.deepEqual(getTargets(config).map(t=>t.id),['bilibili','douyin']);
  assert.equal(config.bilibiliAccounts[1].privateField,'kept');
  saveSettings({...settingsView(config),enabledPlatforms:['douyin']});
  assert.throws(()=>mod.setPlatformEnabled('bilibili@second',true),/先.*总开关/);
  assert.deepEqual(getTargets(config).map(t=>t.id),['douyin']);
});

test('旧官方停用名单与原平台设置共用同一个开关，单默认账号可恢复', () => {
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({disabled:['bilibili','xhs'],disabledPlatforms:['youtube'],
    site:{enabled:false,base:'https://course.example',custom:'保留'}})); reloadConfig();
  assert.ok(!getTargets(config).some(t=>['bilibili','xhs','youtube','zsz'].includes(t.id)));
  mod.setPlatformEnabled('bilibili',true); mod.setPlatformEnabled('xhs',true);
  assert.ok(getTargets(config).some(t=>t.id==='bilibili')); assert.ok(getTargets(config).some(t=>t.id==='xhs'));
  assert.ok(!getTargets(config).some(t=>t.id==='youtube')); assert.equal(site.SITE,null);
  mod.saveSite({enabled:true, name:'课程站'}); assert.equal(site.SITE.name,'课程站');
  assert.equal(config.site.custom,'保留');
  mod.setPlatformEnabled('bilibili',false); mod.setPlatformEnabled('bilibili',true);
  assert.ok(getTargets(config).some(t=>t.id==='bilibili'));
  assert.deepEqual(config.disabled,config.disabledPlatforms);
});

test('普通站点接受本域接口，拒绝凭证、外站路径和非图片图标', async () => {
  const cfg={site:{custom:17,base:'https://course.example',adminPath:'/manage'}};
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify(cfg)); reloadConfig();
  for(const patch of [{base:'https://user:password@course.example'}, {dashboardApi:'//unrelated.example/api'}, {logo:'config.json'}, {logo:'../outside.svg'}]) {
    assert.throws(()=>mod.saveSite(patch));
  }
  assert.equal((await mod.testSite({dashboardApi:'//unrelated.example/'})).ok,false);
  mod.saveSite({name:'课程站',dashboardApi:'/api/dashboard',logo:'data/logo.png'});
  assert.equal(site.SITE.admin,'https://course.example/manage'); assert.equal(config.site.custom,17);
});
