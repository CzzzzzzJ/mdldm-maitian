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
    disabled:['douyin','xhs','channels','youtube','instagram','x','threads'], learnLinks:false,
    bilibiliAccounts:[{id:'default',name:'主号',uid:'101'}, {id:'second',name:'副号',uid:'202',chromePort:24202,chromeProfile:path.join(dir, 'secondary')}],
  };
  const settings = path.join(dir, 'config.json'), trace = path.join(dir, 'trace'), database = path.join(dir, 'hub.db');
  fs.writeFileSync(path.join(src, 'bridge.mjs'), `
    export async function sleep(ms) {
      if (ms === 300000 && process.env.SYSTEM_ONE_TICK === '1') process.exit(0);
    }
  `);
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
  fs.writeFileSync(path.join(lib, 'cdp.js'), `
    export const evaluate = async (tab, expr) => {
      if (expr?.includes('1.0/profile')) return null;
      if (expr?.includes('document') && !expr.includes('isLogin')) { chrome.record('evaluate',expr); return null; }
      return tab === 24101 ? (process.env.SYSTEM_PRIMARY_UID ?? '101') : (process.env.SYSTEM_SECOND_UID ?? '202');
    };
    export const click = () => { chrome.record('click'); throw Error('browser click forbidden in fixture'); };
    export const send = async (tab,method) => {
      if (method !== 'Page.captureScreenshot') throw Error('unexpected CDP command');
      return {data:''};
    };
  `);
  fs.writeFileSync(path.join(lib, 'publish.js'), `
    export const ADAPTERS = {bilibili:{}, xhs:{}, threads:{}};
    export const preflight = async ids => {
      chrome.record('preflight', ids);
      return Object.fromEntries(ids.map(id => [id, {
        ok: !(id === 'bilibili' && process.env.SYSTEM_ADAPTER_OFFLINE === '1')
      }]));
    };
    export async function run(project, {platforms, onChange}) {
      chrome.record('run', platforms);
      for (const id of platforms) onChange({id, status:'已填写', logs:[], tabId:1});
      return {};
    }
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

function eveningFixture(t) {
  const f = fixture(t);
  const root = f.config.rootPath, project = path.join(root, 'tomorrow');
  fs.mkdirSync(project);
  f.config.bilibiliAccounts[0].enabled = false;
  f.config.batches = [['bilibili', 'xhs']];
  f.config.manual = ['bilibili', 'xhs'];
  fs.writeFileSync(path.join(root, 'lib', 'bundle.js'),
    'export const validate = () => ({errors:[], warnings:[]}), PLATFORMS = {}, len = s => s.length;');
  fs.writeFileSync(path.join(root, 'clock.mjs'), `
    import { mock } from 'node:test';
    mock.timers.enable({apis:['Date'], now:Date.parse('2026-11-24T21:00:00+08:00')});
  `);
  const env = {TZ:'Asia/Shanghai', NODE_OPTIONS:'--import=./clock.mjs', HUB_NO_WEB:'1', SYSTEM_ONE_TICK:'1'};
  const sql = fn => {
    const db = new DatabaseSync(f.database);
    try { return fn(db); } finally { db.close(); }
  };
  const plan = (platforms = {bilibili:{}}) => {
    fs.writeFileSync(path.join(project, 'publish.json'), JSON.stringify({
      id:'eve', name:'次日投稿', episode:1, schedule:'2026-11-25T09:00:00+08:00', platforms
    }));
    const r = f.cli(['plan', project], env);
    assert.equal(r.status, 0, r.stderr);
    sql(db => {
      // Isolate the evening check from daily maintenance in the same daemon tick.
      const day = new Date('2026-11-24T21:00:00+08:00').toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai'});
      for (const key of ['doctorDay','metricsDay']) db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(key,day);
    });
  };
  const evening = extra => {
    const r = f.cli(['daemon'], {...env, ...extra});
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /守护循环出错/);
    return r;
  };
  const task = () => sql(db => db.prepare("SELECT state FROM tasks WHERE episode_id='eve' AND platform='bilibili'").get()?.state);
  return {...f, project, plan, evening, task, sql};
}

test('evening checks the publishing primary when its account switch is off and the secondary is online', t => {
  const f = eveningFixture(t);
  f.plan();
  assert.equal(f.task(), 'planned');
  const routine = f.cli(['doctor','--quiet']);
  assert.equal(routine.status, 0, routine.stderr);
  assert.deepEqual(routine.events.filter(e => e[0] === 'preflight').map(e => e[1]), [24202]);

  const eve = f.evening({SYSTEM_PRIMARY_UID:''});
  assert.match(eve.stdout, /今晚先把这些平台登录好：B站 · 主号/);
  assert.doesNotMatch(eve.stdout, /所有已检查的账号登录都正常/);
  assert.ok(eve.events.some(([op,port]) => op === 'tab' && port === 24101));
  assert.ok(eve.events.every(([,port]) => port !== 24202));
  assert.equal(f.status('bilibili'), 'out');
});

test('evening checks the legacy primary with platform preflight even when both account rows are off', t => {
  const f = eveningFixture(t);
  delete f.config.bilibiliAccounts[0].uid;
  f.config.bilibiliAccounts[1].enabled = false;
  f.plan();
  const eve = f.evening({SYSTEM_ADAPTER_OFFLINE:'1'});
  assert.deepEqual(eve.events.filter(e => e[0] === 'preflight').map(e => [e[1],e[3]]), [[24101,['bilibili']]]);
  assert.match(eve.stdout, /今晚先把这些平台登录好：B站 · 主号/);
  assert.equal(f.status('bilibili'), 'out');
});

test('evening rejects a different primary UID recorded in SQLite', t => {
  const f = eveningFixture(t);
  delete f.config.bilibiliAccounts[0].uid;
  f.plan();
  f.sql(db => db.prepare('INSERT INTO account_traffic_identity(platform,uid) VALUES (?,?)').run('bilibili','303'));
  const eve = f.evening(); // Primary Chrome is logged in as UID 101.
  assert.match(eve.stdout, /登录 UID 与账号绑定不一致/);
  assert.match(eve.stdout, /今晚先把这些平台登录好：B站 · 主号/);
  assert.equal(f.status('bilibili'), 'out');
});

test('evening uses current platform settings when Bilibili was disabled after planning', t => {
  const f = eveningFixture(t);
  f.config.disabled = f.config.disabled.filter(id => id !== 'xhs');
  f.plan({bilibili:{}, xhs:{}});
  assert.equal(f.task(), 'planned');
  f.config.disabled.push('bilibili');
  const eve = f.evening();
  assert.deepEqual(eve.events.filter(e => e[0] === 'preflight').map(e => e[3]), [['xhs']]);
  assert.match(eve.stdout, /所有已检查的账号登录都正常/);
  assert.equal(f.status('bilibili'), undefined);
  const run = f.cli(['run', f.project, '--only', 'bilibili']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(f.task(), 'skipped');
  assert.deepEqual(run.events, []);
});

test('evening skips Bilibili for an episode that only plans another platform', t => {
  const f = eveningFixture(t);
  f.config.disabled = f.config.disabled.filter(id => id !== 'xhs');
  f.plan({bilibili:{skip:true}, xhs:{}});
  assert.equal(f.task(), 'skipped');
  const eve = f.evening();
  assert.deepEqual(eve.events.filter(e => e[0] === 'preflight').map(e => [e[1],e[3]]), [[24101,['xhs']]]);
  assert.equal(f.status(secondary), undefined);
});

test('evening sends no success notification when the only planned platform has since been disabled', t => {
  const f = eveningFixture(t);
  f.plan();
  f.config.disabled.push('bilibili');
  const eve = f.evening();
  assert.deepEqual(eve.events, []);
  assert.doesNotMatch(eve.stdout, /明天 .* 发布/);
  // Allow the check to run if the platform is re-enabled during the same evening.
  assert.equal(f.sql(db => db.prepare("SELECT value FROM meta WHERE key='eve:eve'").get()), undefined);
});

test('run still fills Bilibili on the primary profile with its account switch off', t => {
  const f = eveningFixture(t);
  f.plan();
  const run = f.cli(['run', f.project, '--only', 'bilibili']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.events.filter(e => ['preflight','run'].includes(e[0])).map(e => [e[0],e[1],e[3]]),
    [['preflight',24101,['bilibili']], ['run',24101,['bilibili']]]);
  assert.equal(f.task(), 'awaiting_user');
});


test('scheduled Threads is included in the night check but stops at manual scheduling on run', t => {
  const f = eveningFixture(t);
  f.config.disabled = f.config.disabled.filter(id => id !== 'threads');
  f.config.auto = ['threads']; // Not in the existing config's batches or manual list.
  f.plan({bilibili:{}, threads:{text:'Schedule this Threads post manually'}});
  const eve = f.evening();
  assert.equal(f.status('threads'), 'ok');
  assert.equal(f.status('bilibili'), 'ok');
  assert.ok(eve.events.some(([op,port,,ids]) => op === 'preflight' && port === 24101 && ids.includes('threads')));
  assert.ok(eve.events.every(([,port]) => port !== 24202));

  const run = f.cli(['run', f.project, '--only', 'threads']);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.events.some(([op,port,,ids]) => op === 'run' && port === 24101 && ids.includes('threads')));
  assert.ok(!run.events.some(([op]) => op === 'click'));
  const state = f.sql(db => db.prepare("SELECT state,detail FROM tasks WHERE episode_id='eve' AND platform='threads'").get());
  assert.equal(state.state, 'awaiting_user');
  assert.match(state.detail, /手动设定时/);
});
