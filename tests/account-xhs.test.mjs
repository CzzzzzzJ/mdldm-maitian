import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourceUrl = new URL('../src/account-xhs.mjs', import.meta.url);
function card(id, views, text = '2026-11-16 12:00', title = id) {
  const stats = [String(views), '2', '3', '4', '5'];
  return { innerText: `${title}\n${text}`, getAttribute: key => key === 'data-impression' ? JSON.stringify({noteTarget:{value:{noteId:id}}}) : '', querySelector: key => key === '.note-card__title' ? {innerText:title} : null, querySelectorAll: key => key === '.note-card__stat' ? stats.map(innerText => ({innerText})) : [] };
}
function fixture(pages, { noNext = false, auth = false, unchanged = false, nestedScroll = false, loadingReads = 0, loadingText = '加载中...' } = {}) {
  let page = 0, closes = 0;
  const next = { disabled: false, className: 'btn-next', getAttribute: key => key === 'aria-label' ? '下一页' : null, getBoundingClientRect: () => ({width:20,height:20}), click() { if (!unchanged) page++; } };
  const scroller = {parentElement:null,scrollHeight:1000,clientHeight:500,overflowY:'scroll',set scrollTop(value) {if(nestedScroll && page < pages.length - 1) page++;}};
  for (const p of pages) for (const c of p.cards) c.parentElement=scroller;
  const document = { body: {get innerText() {if(loadingReads>0)return loadingText;return auth ? '扫码登录' : pages[page].text || '';}, scrollHeight:1000}, documentElement:{scrollHeight:1000},
    querySelectorAll(selector) { if (selector === '.note-card') {if(loadingReads>0){loadingReads--;return [];}return pages[page].cards;} if (selector === 'button,[role="button"],a') { next.disabled = page === pages.length - 1; return noNext ? [] : [next]; } return []; },
    querySelector(selector) {return selector === '.note-card' ? pages[page].cards[0] || null : null;} };
  const browser = vm.createContext({ document, location:{href:auth ? 'https://creator.xiaohongshu.com/login' : 'https://creator.xiaohongshu.com/new/note-manager'}, window:{scrollTo(){}}, getComputedStyle:e => ({display:'block',visibility:'visible',overflowY:e.overflowY || 'visible'}) });
  const ctx = vm.createContext({ URL, Date, Set, Map, console,
    withTab:async(url,fn)=>{assert.equal(url,'https://creator.xiaohongshu.com/new/note-manager');try{return await fn(7);}finally{closes++;}},
    evaluate:async(tab,expr)=>{assert.equal(tab,7);return vm.runInContext(expr,browser);}, sleep:async()=>{} });
  const source = fs.readFileSync(sourceUrl,'utf8').replace(/^import .*from '\.\/driver\.mjs';\n/m,'').replace(/^export /gm,'');
  vm.runInContext(source,ctx);
  return {collect:()=>vm.runInContext('collectXhsVideos()',ctx),closes:()=>closes};
}

test('XHS reads every pagination page, preserves zero views and excludes unpublished notes',async()=>{
  const f=fixture([{cards:[card('note1',0),card('draft',99,'审核中')],text:'笔记管理'},{cards:[card('note2',1)],text:'笔记管理'}]);
  const rows=JSON.parse(JSON.stringify(await f.collect()));
  assert.deepEqual(rows.map(r=>[r.id,r.views]),[['note1',0],['note2',1]]);
  assert.deepEqual(rows[0],{id:'note1',title:'note1',url:'https://www.xiaohongshu.com/explore/note1',publishedAt:'2026-11-16T04:00:00.000Z',views:0,comments:2,likes:3,favorites:4,shares:5,extra:{}});
  assert.equal(f.closes(),1);
});
test('XHS accepts explicit empty account and rejects a login page',async()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture([{cards:[],text:'暂无笔记'}],{noNext:true}).collect())),[]);
  await assert.rejects(fixture([{cards:[],text:''}],{auth:true}).collect(),/登录/);
});
test('XHS never calls an unknown terminal state a complete account history',async()=>{
  await assert.rejects(fixture([{cards:[card('note1',2)],text:'笔记管理'}],{noNext:true}).collect(),/未确认.*全部/);
  await assert.rejects(fixture([{cards:[card('note1',2)]},{cards:[card('note2',3)]}],{unchanged:true}).collect(),/翻页.*未变化/);
});
test('XHS accepts a terminal marker but refuses unreadable published metrics',async()=>{
  const f=fixture([{cards:[card('note1',1)],text:'没有更多了'}],{noNext:true});
  assert.equal((await f.collect()).length,1);
  const broken=card('note1',1);broken.querySelectorAll=()=>[];
  await assert.rejects(fixture([{cards:[broken],text:'没有更多了'}],{noNext:true}).collect(),/指标/);
});

test('XHS scrolls the note list container and uses the account total to prove completeness',async()=>{
  const f=fixture([{cards:[card('first',0)],text:'全部 2\n加载中...'},{cards:[card('first',0),card('second',1)],text:'全部 2'}],{noNext:true,nestedScroll:true});
  assert.deepEqual(JSON.parse(JSON.stringify((await f.collect()).map(r=>[r.id,r.views]))),[['first',0],['second',1]]);
});

test('XHS waits for creator cards instead of treating a slow page as an empty account',async()=>{
  const f=fixture([{cards:[card('delayed',1)],text:'没有更多了'}],{noNext:true,loadingReads:6});
  assert.equal((await f.collect()).length,1);
});

test('XHS never treats a transient zero header during loading as a verified empty account',async()=>{
  const f=fixture([{cards:[card('delayed',1)],text:'没有更多了'}],{noNext:true,loadingReads:6,loadingText:'全部 0\n加载中...'});
  assert.equal((await f.collect()).length,1);
});
