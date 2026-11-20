import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initAccountTraffic, saveAccountVideos, accountTrafficView, syncAccountTraffic } from '../src/account-traffic.mjs';

const video = (id, views = 0) => ({ id, title: `作品 ${id}`, url: `https://www.bilibili.com/video/${id}`, publishedAt: '2026-10-01T00:00:00.000Z', views, likes: 1, comments: null, favorites: 0, shares: null, extra: {} });
test('account collection keeps identical video IDs separate and includes zero views without registering projects', () => {
  const db = new DatabaseSync(':memory:'); initAccountTraffic(db);
  try {
    saveAccountVideos(db, 'bilibili', [video('BV1', 0)], '2026-11-17T08:00:00.000Z');
    saveAccountVideos(db, 'bilibili@second', [video('BV1', 12)], '2026-11-17T08:00:00.000Z');
    const v = accountTrafficView(db, ['bilibili', 'bilibili@second']);
    assert.equal(v.videos.length, 2);
    assert.equal(v.videos.find(x => x.platform === 'bilibili').views, 0);
    assert.equal(v.videos.find(x => x.platform === 'bilibili').comments, null);
    assert.equal(v.videos.find(x => x.platform === 'bilibili@second').views, 12);
    assert.equal(accountTrafficView(db, ['bilibili']).videos.length, 1);
    assert.equal(accountTrafficView(db, []).videos.length, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('episodes','tasks')").get().n, 0);
  } finally { db.close(); }
});
test('invalid later rows cannot overwrite earlier account data and repeat collection updates one daily sample', () => {
  const db = new DatabaseSync(':memory:'); initAccountTraffic(db);
  try {
    saveAccountVideos(db, 'bilibili', [video('BV1', 9)], '2026-11-17T08:00:00.000Z');
    assert.throws(() => saveAccountVideos(db, 'bilibili', [video('BV1', 99), video('BV2', -1)], '2026-11-17T09:00:00.000Z'));
    assert.equal(accountTrafficView(db, ['bilibili']).videos[0].views, 9);
    saveAccountVideos(db, 'bilibili', [video('BV1', 10)], '2026-11-17T09:00:00.000Z');
    const view = accountTrafficView(db, ['bilibili']);
    assert.equal(view.videos[0].views, 10);
    assert.equal(view.history.length, 1);
    assert.equal(view.history[0].views, 10);
    assert.equal(view.history[0].day, '2026-11-17');
    assert.equal(view.videos[0].collectedAt, '2026-11-17T09:00:00.000Z');
    saveAccountVideos(db, 'bilibili', [], '2026-11-18T09:00:00.000Z');
    assert.equal(accountTrafficView(db, ['bilibili']).videos.length, 0);
    assert.equal(db.prepare('SELECT views FROM account_videos').get().views, 10);
  } finally { db.close(); }
});
test('a thousand stored videos read quickly and disabled accounts stay excluded from history', () => {
  const db = new DatabaseSync(':memory:'); initAccountTraffic(db);
  try {
    saveAccountVideos(db, 'bilibili', Array.from({ length: 1000 }, (_, i) => video(`BV${i}`, i)), '2026-11-17T09:00:00.000Z');
    const started = performance.now(), view = accountTrafficView(db, ['bilibili']);
    assert.equal(view.videos.length, 1000);
    assert.equal(view.history[0].views, 499500);
    assert.equal(accountTrafficView(db, []).history.length, 0);
    assert.ok(performance.now() - started < 1000);
  } finally { db.close(); }
});
test('no enabled account returns immediately without reading stored traffic', () => {
  const db = { prepare() { throw new Error('unexpected database read'); } };
  assert.deepEqual(accountTrafficView(db, []), { videos: [], history: [], statuses: [] });
});
test('collection isolates an account failure and rejects concurrent or disabled-account writes', async () => {
  const db = new DatabaseSync(':memory:'); initAccountTraffic(db);
  const targets = [{ id: 'bilibili', uid: '100' }, { id: 'bilibili@second', uid: '200' }];
  try {
    let release; const wait = new Promise(resolve => { release = resolve; });
    const pending = syncAccountTraffic({ db, targets, read: async target => { await wait; if (target.id.endsWith('second')) throw new Error('登录过期'); return [video('BV1', 1)]; }, currentTargets: () => targets });
    await assert.rejects(syncAccountTraffic({ db, targets, read: async () => [] }), /正在进行/);
    release(); const result = await pending;
    assert.equal(result[0].count, 1); assert.match(result[1].error, /登录过期/);
    const v = accountTrafficView(db, targets.map(t => t.id));
    assert.equal(v.videos.length, 1); assert.equal(v.statuses.find(s => s.id.endsWith('second')).error, '登录过期');
    let reads = 0;
    const disabled = await syncAccountTraffic({ db, targets: [targets[0]], currentTargets: () => [], read: async () => { reads++; return [video('BV1', 100)]; } });
    assert.match(disabled[0].error, /配置已变更/);
    assert.equal(reads,0);
    assert.equal(accountTrafficView(db, ['bilibili']).videos[0].views, 1);
  } finally { db.close(); }
});
test('a replaced worker cannot overwrite a newer successful status', async () => {
  const db = new DatabaseSync(':memory:'); initAccountTraffic(db);
  try {
    let release, entered; const start = new Promise(resolve => {entered=resolve;});
    const wait = new Promise(resolve => {release=resolve;});
    const pending = syncAccountTraffic({db,targets:[{id:'bilibili'}],read:async()=>{entered();await wait;return [video('BV1',1)];}});
    await start;
    db.prepare('UPDATE account_traffic_lock SET owner=?').run('new-owner');
    saveAccountVideos(db,'bilibili',[video('BV1',12)]);
    release(); await pending;
    const v = accountTrafficView(db,['bilibili']);
    assert.equal(v.videos[0].views,12); assert.equal(v.statuses[0].error,'');
    assert.equal(db.prepare('SELECT owner FROM account_traffic_lock').get().owner,'new-owner');
  } finally { db.close(); }
});
