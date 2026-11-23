import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

test('account traffic API is isolated, authenticated, and does not accept browser arguments', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maitian-traffic-web-'));
  const configFile = path.join(dir,'config.json'), dbFile = path.join(dir,'test.db');
  process.env.MAITIAN_CONFIG = configFile;
  process.env.MAITIAN_DB = dbFile;
  const cfg = { rootPath: dir, web: { port:0, key:'test-traffic-key' }, disabled:['douyin','xhs'],
    bilibiliAccounts:[{ id:'second', name:'副号', uid:'42' }] };
  await writeFile(configFile, JSON.stringify(cfg));
  const { db } = await import('../src/db.mjs');
  const { saveAccountVideos } = await import('../src/account-traffic.mjs');
  await import('../src/followers.mjs'); // hub loads the existing followers schema before web.
  const { startWeb } = await import('../src/web.mjs');
  const srv = startWeb();
  t.after(async () => {
    srv.close();
    db.close();
    await rm(dir,{ recursive:true, force:true });
  });
  await once(srv,'listening');
  const endpoint = `http://127.0.0.1:${srv.address().port}/api/account-traffic`;
  const headers = { cookie:'mt_key=test-traffic-key' };
  const row = { id:'BV1', title:'<a>', url:'https://www.bilibili.com/video/BV1', views:0, likes:0 };
  saveAccountVideos(db,'bilibili@second',[row]);
  saveAccountVideos(db,'douyin',[row]);
  assert.equal((await fetch(endpoint)).status,401);
  const result = await fetch(endpoint,{headers}).then(r=>r.json());
  assert.deepEqual(result.accounts.map(a=>a.id),['bilibili','bilibili@second']);
  assert.deepEqual(Object.keys(result.accounts[1]).sort(), ['accountId','id','name','platform']);
  assert.equal(result.videos.length,1);
  assert.equal(result.videos[0].views,0);
  const post = (data, extra = {}) => fetch(endpoint,{method:'POST',headers:{...headers,'content-type':'application/json',...extra},body:JSON.stringify(data)});
  assert.equal((await post({type:'metricsLogin',id:'--bad',chromePort:31337})).status,400);
  assert.equal((await post({type:'login',id:'bilibili@second'})).status,400);
  assert.equal((await post({type:'metricsAccounts'},{origin:'https://example.test'})).status,403);
  assert.equal((await fetch(endpoint,{method:'PUT',headers})).status,405);
  cfg.disabled.push('bilibili');
  await writeFile(configFile,JSON.stringify(cfg));
  assert.deepEqual((await fetch(endpoint,{headers}).then(r=>r.json())).statuses,[]);
  assert.equal((await fetch(endpoint,{headers}).then(r=>r.json())).videos.length,0);
  assert.equal((await post({type:'metricsAccounts'})).status,200, 'safe empty collection starts without any browser');
  const overview = endpoint.replace('/account-traffic','/overview');
  let action;
  for (let i=0;i<30;i++) {
    const body = await fetch(overview,{headers}).then(r=>r.json());
    assert.ok(body.actions, JSON.stringify(body));
    action = body.actions.find(a=>a.type==='metricsAccounts');
    if (action?.done) break;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(action?.ok,true,action?.tail);
});

test('traffic page renders useful empty/account/project states and safely escapes account content', async () => {
  const html = await readFile(new URL('../src/web/pages.html',import.meta.url),'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);[^\n]*$/m,'');
  const esc = v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const sandbox = { document:{addEventListener(){}},addEventListener(){},
    esc, sum:(rows,k)=>rows.reduce((n,r)=>n+(r[k]||0),0), when:()=>'', fmt:n=>n==null?'–':String(n), safeUrl:u=>/^https:\/\//.test(u)?esc(u):'', logo:()=>'', PL:[], PN:{}, pct:()=> '–' };
  vm.createContext(sandbox);
  vm.runInContext(script,sandbox);
  const render = () => vm.runInContext('vTraffic()',sandbox);
  vm.runInContext("O={episodes:[],actions:[]}; accountTraffic={accounts:[],statuses:[]}",sandbox);
  assert.match(render(),/还没采到流量/);
  vm.runInContext(`
    accountTraffic={direct:true,accounts:[{id:'bilibili@second',name:'<副号>',platform:'bilibili'}],
      statuses:[{id:'bilibili@second',count:51,syncedAt:'2026-11-20',error:'<故障>'}],
      videos:Array.from({length:51},(_,i)=>({title:'<作品>'+i,url:'https://example.test/v',platform:'bilibili@second',views:0,likes:null})),history:[]};
  `, sandbox);
  const account = render();
  assert.match(account,/采集账号流量/);
  assert.match(account,/打开登录页/);
  assert.match(account,/&lt;故障>/);
  assert.match(account,/&lt;副号>/);
  assert.match(account,/1 \/ 2/);
  assert.doesNotMatch(account,/&lt;作品>50/);
  vm.runInContext("trafficSource='account'; trafficPage=1; O.episodes=[{id:'example', views:2,inter:0, name:'a',nick:'a', tasks:[],covers:[]}] ; PL=['bilibili']",sandbox);
  assert.match(render(),/&lt;作品>50/);
  assert.match(render(),/发布工程/);
  vm.runInContext("trafficSource='projects'",sandbox);
  assert.match(render(),/每期 × 平台/);
  // 默认先看「发布工程」：两种数据都有时，默认视图是按期的流量
});
