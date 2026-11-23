import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the normal CLI and driver. Only the Chrome connection and the
// installed adapter are replaced, so no real browser or account is touched.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-system-login-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const src = path.join(dir, 'src'), lib = path.join(dir, 'lib');
  fs.cpSync(fileURLToPath(new URL('../src', import.meta.url)), src, { recursive:true });
  fs.mkdirSync(lib);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const config = {
    plugin:'local', pluginDir:dir, rootPath:dir, chromePort:24101, chromeProfile:path.join(dir, 'primary'),
    disabled:['douyin','xhs','channels','youtube','instagram','x'], learnLinks:false,
    bilibiliAccounts:[{id:'default',name:'主号',uid:'101'}, {id:'second',name:'副号',uid:'202',chromePort:24202,chromeProfile:path.join(dir, 'secondary')}],
  };
  const settings = path.join(dir, 'config.json'), trace = path.join(dir, 'trace'), database = path.join(dir, 'hub.db');
  fs.writeFileSync(path.join(src, 'bridge.mjs'), 'export const sleep = async () => {};');
  fs.writeFileSync(path.join(src, 'chrome-shim.mjs'), `
    import { AsyncLocalStorage } from 'node:async_hooks';
    import fs from 'node:fs';
    import { config } from './feishu.mjs';
    export const PROFILE = config.chromeProfile;
    const context = new AsyncLocalStorage();
    export const withBrowser = (target, fn) => context.run(target, fn);
    function record(op, arg) {
      const target = context.getStore() || config;
      fs.appendFileSync(process.env.SYSTEM_TRACE, JSON.stringify([op, target.chromePort, target.chromeProfile, arg])+'\\n');
      return target.chromePort;
    }
    export const launchChrome = () => record('launch');
    export const closeConnection = () => {};
    export const chrome = { record, tabs: { create: async ({url}) => ({id:record('tab',url)}), remove:async () => {} } };
  `);
  fs.writeFileSync(path.join(lib, 'cdp.js'), `export const evaluate = async tab => tab === 24101 ? '101' : process.env.SYSTEM_SECOND_UID || '202';`);
  fs.writeFileSync(path.join(lib, 'publish.js'), `
    export const ADAPTERS = {bilibili:{}};
    export const preflight = async ids => {
      chrome.record('preflight', ids);
      return Object.fromEntries(ids.map(id=>[id,{ok:true}]));
    };
  `);
  const cli = (args, extra = {}) => {
    fs.writeFileSync(settings, JSON.stringify(config));
    fs.writeFileSync(trace, '');
    const run = spawnSync(process.execPath, ['src/hub.mjs', ...args], { cwd:dir, encoding:'utf8', timeout:6000,
      env:{...process.env, MAITIAN_CONFIG:settings, MAITIAN_DB:database, HUB_DRIVER:'direct', SYSTEM_TRACE:trace, ...extra} });
    assert.ifError(run.error);
    return {...run, events:fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)};
  };
  const status = id => {
    const db = new DatabaseSync(database);
    try { return db.prepare('SELECT value FROM meta WHERE key=?').get('login:'+id)?.value; }
    finally { db.close(); }
  };
  return {config, cli, status, database};
}

const secondary = 'bilibili' + '@second';
test('named account checks and login use only the chosen Chrome profile', t => {
  const f = fixture(t);
  for (const [key, account, port, profile] of [
    [secondary, '副号', 24202, f.config.bilibiliAccounts[1].chromeProfile],
    ['bilibili', '主号', 24101, f.config.chromeProfile],
  ]) {
    const check = f.cli(['doctor','--target',key,'--quiet']);
    assert.equal(check.status,0,check.stderr);
    assert.match(check.stdout, new RegExp(account+'：✅'));
    assert.ok(check.events.every(e=>e[1]===port && e[2]===profile));
    assert.equal(check.events.filter(e=>e[0]==='tab' && e[3].includes('/nav')).length,1);
    assert.deepEqual(check.events.filter(e=>e[0]==='preflight').map(e=>e[3]), [['bilibili']]);
    assert.equal(f.status(key),'ok');

    const open = f.cli(['login','--target',key]);
    assert.equal(open.status,0,open.stderr);
    assert.deepEqual(open.events.filter(e=>e[0]==='tab'), [['tab',port,profile,'https://member.bilibili.com/']]);
    assert.ok(open.events.every(e=>e[1]===port));
  }
  const wrong = f.cli(['doctor','--target',secondary,'--quiet'], {SYSTEM_SECOND_UID:'101'});
  assert.equal(wrong.status,0,wrong.stderr);
  assert.match(wrong.stdout,/UID/);
  assert.ok(!wrong.events.some(e=>e[0]==='preflight'));
  assert.equal(f.status(secondary),'out');
  assert.equal(f.status('bilibili'),'ok');
});

test('bulk and legacy selectors preserve enabled accounts and unbound primary preflight', t => {
  const f=fixture(t);
  delete f.config.bilibiliAccounts[0].uid;
  const bulk=f.cli(['doctor','--quiet']);
  assert.equal(bulk.status,0,bulk.stderr);
  assert.deepEqual(bulk.events.filter(e=>e[0]==='preflight').map(e=>e[1]).sort(),[24101,24202]);
  assert.ok(!bulk.events.some(e=>e[0]==='tab' && e[1]===24101));
  const legacy=f.cli(['doctor','--only','bilibili','--quiet']);
  assert.equal(legacy.status,0,legacy.stderr);
  assert.deepEqual(legacy.events.filter(e=>e[0]==='preflight').map(e=>e[1]),[24101]);
  f.config.bilibiliAccounts[0].enabled=false;
  const secondaryOnly=f.cli(['login']);
  assert.equal(secondaryOnly.status,0,secondaryOnly.stderr);
  assert.deepEqual(secondaryOnly.events.filter(e=>e[0]==='tab').map(e=>e[1]),[24202]);
});

test('a saved UID verifies an unbound account and an unknown secondary is never marked logged in', t => {
  const f = fixture(t);
  delete f.config.bilibiliAccounts[1].uid;
  const check = () => f.cli(['doctor','--target',secondary,'--quiet']);
  let r = check();
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/填写 UID/);
  assert.deepEqual(r.events,[]);
  assert.equal(f.status(secondary),'out');

  const db = new DatabaseSync(f.database);
  db.prepare('INSERT INTO account_traffic_identity(platform,uid) VALUES (?,?)').run(secondary,'202');
  db.close();
  r = check();
  assert.equal(r.status,0,r.stderr);
  assert.ok(r.events.some(e=>e[0]==='preflight' && e[1]===24202));
  assert.equal(f.status(secondary),'ok');
});

test('invalid, disabled, or unsupported targets never fall back to opening multiple accounts', t => {
  const f=fixture(t);
  const refused = (args,extra) => {
    const r=f.cli(args,extra);
    assert.equal(r.status,1,r.stderr);
    assert.deepEqual(r.events,[]);
  };
  for (const args of [['--target'],['--target='],['--target','missing'],['--target',secondary,'--only','bilibili'],['--target','bilibili','--target',secondary]]) {
    refused(['login',...args]);
  }
  refused(['doctor','--target',secondary,'--quiet'],{HUB_DRIVER:'plugin'});
  refused(['login','--target',secondary],{HUB_DRIVER:'plugin'});
  f.config.bilibiliAccounts[1].enabled=false;
  refused(['login','--target',secondary]);
  f.config.bilibiliAccounts[1].enabled=true;
  f.config.bilibiliAccounts[1].removed=true;
  refused(['doctor','--target',secondary,'--quiet']);
  f.config.disabled.push('bilibili');
  refused(['doctor','--target','bilibili','--quiet']);
});
