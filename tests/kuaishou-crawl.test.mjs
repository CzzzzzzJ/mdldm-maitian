import test from 'node:test';
import assert from 'node:assert/strict';

const card = (id,state='public') => ({id,state,...(state==='public'?{video:{id,views:0}}:{})});
const snap = (total,cards=[],extra={}) => ({total,cards,...extra});
async function crawl(snapshots, options={}) {
  const { crawlKuaishouList } = await import('../src/kuaishou-crawl.mjs');
  let i=0;
  return crawlKuaishouList({
    snapshot:async()=>snapshots[Math.min(i++,snapshots.length-1)],
    advance:async()=>{}, wait:async()=>{}, attempts:snapshots.length,
  }, options);
}
test('快手临时零不会提前返回；跨页去重并区分私密作品', async () => {
  const final=snap(3,[card('bbb','private'),card('ccc')]);
  const result=await crawl([snap(0),snap(3,[card('aaa'),card('bbb','private')]),final,final]);
  assert.deepEqual(result,{rows:[{id:'aaa',views:0},{id:'ccc',views:0}],total:3,checked:3,skipped:{private:1,unpublished:0}});
});
test('快手列表未读全或出现未知作品，拒绝返回部分结果或假零', async () => {
  for (const state of [snap(4,[card('aaa')]),snap(0),snap(2,[card('aaa'),card('bbb','unknown')])]) {
    await assert.rejects(crawl([state,state,state]), /未读到完整作品列表/);
  }
});
test('快手经两次确认的明示空列表可以返回真实的零', async () => {
  const empty=snap(0,[],{empty:true});
  assert.deepEqual(await crawl([empty,empty]),{rows:[],total:0,checked:0,skipped:{private:0,unpublished:0}});
});
test('已验证 ID 支持定位后续分页单个作品，不将私密作品关联为公开', async () => {
  const before=snap(3,[card('aaa')]), after=snap(3,[card('aaa'),card('bbb'),card('ccc','private')]);
  assert.deepEqual(await crawl([before,after],{workId:'bbb'}),{id:'bbb',views:0});
  assert.equal(await crawl([before,after],{workId:'ccc'}),null);
});
