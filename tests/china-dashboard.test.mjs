import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initAccountTraffic, saveAccountVideos } from '../src/account-traffic.mjs';
import { accountSummaries, accountWorkForUrl, accountCandidates } from '../src/china-dashboard.mjs';

test('dashboard distinguishes account totals, missing snapshots and real zero', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initAccountTraffic(db);
    assert.equal(accountSummaries(db, ['kuaishou']).kuaishou, undefined);
    saveAccountVideos(db, 'kuaishou', [
      { id:'abc', title:'某一期', url:'https://www.kuaishou.com/short-video/abc', views:0, likes:2 },
      { id:'other', title:'其他', url:'https://www.kuaishou.com/short-video/other', views:10 }
    ]);
    const summary = accountSummaries(db, ['kuaishou']).kuaishou;
    assert.equal(summary.videos, 2);
    assert.equal(summary.views, 10);
    assert.ok(summary.syncedAt);
    assert.equal(accountWorkForUrl(db, 'kuaishou', 'https://www.kuaishou.com/short-video/abc?share=1').views, 0);
    assert.equal(accountWorkForUrl(db, 'kuaishou', 'https://unrelated.example/short-video/abc'), null);
    assert.deepEqual(accountCandidates(db, 'kuaishou', ['某一期']).map(r => r.id), ['abc']);
    assert.deepEqual(accountCandidates(db, 'kuaishou', ['同名不存在']), []);
    db.prepare("UPDATE account_traffic_state SET error='未读到完整列表' WHERE platform='kuaishou'").run();
    assert.equal(accountSummaries(db, ['kuaishou']).kuaishou.views, 10);
    assert.equal(accountSummaries(db, ['kuaishou']).kuaishou.error, '未读到完整列表');
  } finally { db.close(); }
});

test('old unverified empty snapshots are not real zeros', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initAccountTraffic(db);
    db.exec(`INSERT INTO account_traffic_state VALUES ('kuaishou','2025-01-01T01:00:00.000Z',0,'');
      INSERT INTO account_traffic_daily VALUES ('2025-01-01','kuaishou',0,0,'2025-01-01T01:00:00.000Z')`);
    assert.equal(accountSummaries(db,['kuaishou']).kuaishou.videos, null);
    assert.equal(accountSummaries(db,['kuaishou']).kuaishou.views, null);
    saveAccountVideos(db,'kuaishou',[]);
    assert.equal(accountSummaries(db,['kuaishou']).kuaishou.videos, 0);
    assert.equal(accountSummaries(db,['kuaishou']).kuaishou.views, 0);
  } finally { db.close(); }
});

test('auth and explicit work ID are required to add a historical episode association', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'maitian-china-dashboard-'));
  process.env.MAITIAN_CONFIG = path.join(dir,'config.json');
  process.env.MAITIAN_DB = path.join(dir,'hub.db');
  await writeFile(process.env.MAITIAN_CONFIG, JSON.stringify({ rootPath:dir, web:{port:0,key:'demo'}, batches:[['acfun','kuaishou']] }));
  const { db, upsertEpisode, getTask } = await import('../src/db.mjs');
  await import('../src/followers.mjs');
  const { startWeb } = await import('../src/web.mjs');
  const srv = startWeb();
  t.after(async () => { srv.close(); db.close(); await rm(dir,{recursive:true,force:true}); });
  await once(srv,'listening');
  upsertEpisode({id:'one',dir,name:'同名作品',episode:1});
  upsertEpisode({id:'two',dir,name:'另一期',episode:2});
  const url='https://www.kuaishou.com/short-video/abc';
  saveAccountVideos(db,'kuaishou',[{id:'abc',title:'同名作品',url,views:0,likes:3},{id:'other', title:'其他作品', url:'https://www.kuaishou.com/short-video/other',views:5}]);
  const base='http://127.0.0.1:'+srv.address().port;
  const headers={cookie:'mt_key=demo','content-type':'application/json'};
  const link=(id,url,hs=headers)=>fetch(base+'/api/episode-account-link',{method:'POST',headers:hs,body:JSON.stringify({id,platform:'kuaishou',url})});
  const before=await fetch(base+'/api/episode?id=one',{headers}).then(r=>r.json());
  assert.equal(before.accountLinks.kuaishou[0].url,url);
  assert.deepEqual(before.tasks,[]);
  assert.equal((await link('one',url,{'content-type':'application/json'})).status,401);
  assert.equal((await link('one',url,{...headers,origin:'https://unrelated.example'})).status,403);
  assert.equal((await link('one','https://www.kuaishou.com/short-video/wrong')).status,404);
  assert.equal((await link('one',url+'?query=1')).status,200);
  assert.equal(getTask('one','kuaishou').state,'published');
  assert.equal((await link('two',url)).status,409);
  assert.equal((await link('one','https://www.kuaishou.com/short-video/other')).status,409);
  const after=await fetch(base+'/api/overview',{headers}).then(r=>r.json());
  assert.equal(after.channelAccounts.kuaishou.views,5);
  assert.equal(after.episodes.find(e=>e.id==='one').views,0);
  assert.equal(after.episodes.find(e=>e.id==='one').tasks[0].m.views,0);
  assert.equal(after.episodes.find(e=>e.id==='one').inter,3);
});
