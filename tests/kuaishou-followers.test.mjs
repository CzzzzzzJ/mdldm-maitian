import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('快手周期净增不会写入或覆盖粉丝总数', async t => {
  const dir = mkdtempSync(join(tmpdir(),'maitian-kuaishou-fans-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  process.env.MAITIAN_CONFIG = join(dir,'config.json');
  process.env.MAITIAN_DB = ':memory:';
  writeFileSync(process.env.MAITIAN_CONFIG, '{}');
  const {db,getMeta} = await import('../src/db.mjs');
  const {saveFollowers} = await import('../src/followers.mjs');
  saveFollowers('kuaishou',{total:123, history:[]});
  saveFollowers('kuaishou',{total:null, history:[], period:{net:-1,days:7}});
  assert.equal(db.prepare("SELECT total FROM followers WHERE platform='kuaishou'").get()?.total,123);
  const period = JSON.parse(getMeta('kuaishouFanPeriod'));
  assert.equal(period.net,-1);
  assert.equal(period.days,7);
  assert.ok(Number.isFinite(Date.parse(period.collectedAt)));
});
