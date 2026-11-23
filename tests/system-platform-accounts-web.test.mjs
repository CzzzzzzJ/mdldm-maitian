import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

test('System rows route exact actions and keep both B站 accounts independently configurable', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-system-platforms-'));
  const file = path.join(tmp, 'config.json');
  const original = {
    web: { port: 0, key: 'fixture' }, rootPath: tmp, chromePort: 19999,
    disabled: ['bilibili','xhs'], bilibiliAccounts: [
      { id: 'second', uid: '200', chromePort: 23456, chromeProfile: path.join(tmp, 'second'), custom: 'retain' },
      { id: 'removed', name: '旧账号', removed: true },
    ],
    unrelated: { enabled: true },
  };
  fs.writeFileSync(file, JSON.stringify(original));
  process.env.MAITIAN_CONFIG = file; process.env.MAITIAN_DB = path.join(tmp, 'hub.db');
  const calls = [];
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (_bin, [hub, ...args]) => {
    assert.equal(path.basename(hub), 'hub.mjs');
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = realSpawn; syncBuiltinESMExports(); fs.rmSync(tmp,{recursive:true,force:true}); });
  const { setMeta } = await import('../src/db.mjs');
  await import('../src/followers.mjs');
  const { startWeb } = await import('../src/web.mjs');
  setMeta('login:bilibili', 'ok'); setMeta('loginDay:bilibili','2026/11/23');
  setMeta('login:bilibili@second','out'); setMeta('loginReason:bilibili@second','需要扫码'); setMeta('loginDay:bilibili@second','2026/11/24');
  const server = startWeb(); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/';
  const headers = { cookie:'mt_key=' + original.web.key, 'content-type':'application/json' };
  const post = (route, body, extra = {}) => fetch(url + route, { method:'POST', headers:{...headers,...extra}, body:JSON.stringify(body) });
  const get = async route => { const r = await fetch(url + route, { headers }); const payload = await r.json(); assert.equal(r.status, 200, payload.error); return payload; };
  const toggle = (platform, on, accountId) => post('platform-toggle',{platform,on,accountId});
  const state = () => JSON.parse(fs.readFileSync(file,'utf8'));
  const rows = async () => (await get('overview')).health.accountRows.filter(p => p.platform === 'bilibili');
  const initial = await rows();
  assert.deepEqual(initial.map(p=>[p.id,p.name,p.disabled,p.state,p.day]), [
    ['bilibili','B站',true,'ok','2026/11/23'], ['bilibili@second','B站 · second',true,'out','2026/11/24'],
  ]);
  assert.equal(initial[1].reason, '需要扫码');
  assert.equal((await post('platform-toggle',{platform:'bilibili',on:true},{origin:'https://other.invalid'})).status,403);
  assert.equal((await post('action',{type:'doctor',platform:'bilibili'})).status,409);
  for (const id of ['', null,'bilibili@unknown','bilibili' + '@removed','bilibili@default','xhs@second']) {
    assert.equal((await post('action',{type:'login',platform:id})).status,400);
    assert.equal((await toggle(id,true)).status,400);
  }
  assert.deepEqual(state(),original); assert.deepEqual(calls,[]);
  const initialSettings = await get('bilibili-accounts');
  // A row preference cannot lift the platform pause. The legacy group request remembers individual choices.
  assert.equal((await toggle('bilibili',false,'default')).status,200);
  assert.equal((await toggle('bilibili',true,'second')).status,200);
  assert.deepEqual((await rows()).map(p=>[p.groupDisabled,p.disabled]),[[true,true],[true,true]]);
  assert.equal((await toggle('bilibili',true)).status,200);
  assert.deepEqual((await rows()).map(p=>[p.groupDisabled,p.disabled]),[[false,true],[false,false]]);
  assert.deepEqual(state().disabled,['xhs']);
  assert.deepEqual(state().bilibiliAccounts.find(a=>a.id==='second'),{...original.bilibiliAccounts[0],enabled:true});
  assert.deepEqual(state().bilibiliAccounts.find(a=>a.id==='removed'),original.bilibiliAccounts[1]);
  assert.equal((await post('bilibili-accounts',{action:'replace',expectedAccounts:initialSettings.bilibiliAccounts,...initialSettings})).status,409);

  const action = async (type,platform) => assert.equal((await post('action',{type,...(platform && {platform})})).status,200);
  await action('doctor','bilibili@second'); await action('login','bilibili@second');
  assert.equal((await toggle('bilibili',true,'default')).status,200);
  await action('doctor','bilibili'); await action('login','bilibili');
  await action('doctor'); await action('login');
  assert.deepEqual(calls, [
    ['doctor','--target','bilibili@second','--quiet'],['login','--target','bilibili@second'],
    ['doctor','--target','bilibili','--quiet'],['login','--target','bilibili'],
    ['doctor','--notify'],['login'],
  ]);
  assert.equal((await toggle('bilibili',false,'second')).status,200);
  assert.equal((await toggle('bilibili',false)).status,200);
  assert.deepEqual((await rows()).map(p=>p.disabled),[true,true]);
  assert.equal((await post('action',{type:'doctor',platform:'bilibili'})).status,409);
  assert.equal((await toggle('bilibili',true)).status,200);
  assert.deepEqual((await rows()).map(p=>p.disabled),[false,true]);
  const { bilibiliAccounts: before } = await get('bilibili-accounts');
  const edits = before.map(({enabled,...account}) => account);
  const result = await post('bilibili-accounts',{action:'replace', expectedAccounts:before, bilibiliAccounts:[...edits,{id:'',name:'新账号',uid:'300'}]});
  assert.equal(result.status,200);
  const saved = (await result.json()).bilibiliAccounts;
  assert.equal(saved.find(a=>a.id==='second').enabled,false);
  assert.ok(saved.find(a=>a.uid==='300').id);
  const secondary = saved.find(a=>a.id==='second');
  const without = saved.filter(a=>a.id!=='second');
  assert.equal((await post('bilibili-accounts',{action:'replace',expectedAccounts:saved,bilibiliAccounts:without})).status,200);
  const restored = await post('bilibili-accounts',{action:'replace',expectedAccounts:without,bilibiliAccounts:[...without,{id:'',name:'重新添加',uid:secondary.uid}]});
  assert.equal(restored.status,200);
  assert.equal((await restored.json()).bilibiliAccounts.find(a=>a.uid===secondary.uid).id,'second');
  assert.equal(state().bilibiliAccounts.find(a=>a.id==='second').chromeProfile,original.bilibiliAccounts[0].chromeProfile);
  assert.deepEqual(state().unrelated,original.unrelated);
  const health = (await get('overview')).health;
  assert.deepEqual(health.platforms.filter(a=>a.id.startsWith('bilibili')).map(a=>a.name),['B站']);
  assert.equal((await toggle('xhs',true)).status,200);
  assert.deepEqual(state().disabled,[]);
});
