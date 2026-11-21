import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-17T04:00:00Z');
const waitFor = async predicate => { for (let i = 0; i < 250; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('child did not reach browser boundary'); };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-sales-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ rootPath: dir, site: { name: '小鹅通', provider: 'xiaoe', shopName: '测试店铺', refundQuery: {page_id:'pi_example',condition_data:{dimension:[{field_id:'test_date'}],metric:[{customizeName:'退款金额',field_id:'test_amount'}],filters:[{field_id:'test_date',filter_operation:'between'}]}},  base: 'https://admin.xiaoe-tech.com', adminPath: '/merchant' } }));
  const env = { ...process.env, MAITIAN_CONFIG: path.join(dir, 'config.json'), MAITIAN_DB: path.join(dir, 'hub.db'), NODE_NO_WARNINGS: '1', TEST_NOW: String(NOW) };
  fs.writeFileSync(path.join(dir, 'src/driver.mjs'), `
    import fs from 'node:fs';
    export const withTab=async(url,run)=>{fs.appendFileSync('browser-calls',process.pid+'\\n');if(process.env.TEST_WAIT)while(!fs.existsSync('release'))await new Promise(r=>setTimeout(r,10));if(process.env.TEST_RELOAD){const{refreshSite}=await import('./site.mjs');refreshSite()}return run(1)};
    export const evaluate=async()=>{
      const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
      return{live:{code:0,data:{today_data:{realIncome:Number(process.env.TEST_CENTS),order_count:1,pay_count:1,uv:10}}},trend:{code:0,data:Object.fromEntries(Array.from({length:30},(_,i)=>{
        const date=new Date(Date.now()-(30-i)*86400000+8*3600000).toISOString().slice(0,10);return[date,{date,data:{order_count:2,pay_money:10001,refund_money:1,pay_users:1,uv:20}}];
      }))},refund:{code:0,data:{result:{dimension:[[{field_id:'test_date',value:day}]],metric:[[{field_id:'test_amount',value:'0.00'}]]}}},orders:{code:0,data:{order_list:[]}},refundError:'',ordersError:''};
    };
  `);
  fs.writeFileSync(path.join(dir, 'run.mjs'), `
    const at=Number(process.env.TEST_NOW),RealDate=Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[at]))}static now(){return at}};
    const{fetchSite}=await import('./src/board.mjs');const{db}=await import('./src/db.mjs');
    try{await fetchSite();console.log('success')}catch(e){console.error(e.message);process.exitCode=2}finally{db.close()}
  `);
  const init=spawnSync(process.execPath,['--input-type=module','-e',"const{db}=await import('./src/db.mjs');db.close()"],{cwd:dir,env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
  const children = [];
  t.after(() => { for (const p of children) if (p.exitCode === null) p.kill(); });
  return { dir, env,
    calls: () => fs.existsSync(path.join(dir, 'browser-calls')) ? fs.readFileSync(path.join(dir, 'browser-calls'), 'utf8').trim().split('\n').filter(Boolean) : [],
    db: () => new DatabaseSync(env.MAITIAN_DB),
    run: (extra = {}) => {
      const child=spawn(process.execPath,['run.mjs'],{cwd:dir,env:{...env,TEST_CENTS:'12345',...extra}});children.push(child);let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
      return new Promise(resolve=>child.on('close',code=>resolve({code,out,err})));
    } };
}

test('independent processes share one sales lease and busy callers preserve errors', async t => {
  const f=fixture(t),first=f.run({TEST_WAIT:'1'}); await waitFor(()=>f.calls().length===1);
  const second=await f.run({TEST_CENTS:'99999'});
  assert.equal(second.code,2);assert.match(second.err,/销售同步正在进行/);assert.equal(f.calls().length,1);
  const db=f.db();assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteError'").get()?.value,undefined);db.close();
  fs.writeFileSync(path.join(f.dir,'release'),'1');assert.equal((await first).code,0);
  assert.equal((await f.run({TEST_CENTS:'45678'})).code,0);assert.equal(f.calls().length,2);
  const stored=f.db();assert.equal(stored.prepare("SELECT revenue FROM site_daily WHERE day='2026-11-17'").get().revenue,456.78);stored.close();
});

test('expired leases recover and a former owner cannot overwrite a newer snapshot or error', async t => {
  const f=fixture(t),first=f.run({TEST_WAIT:'1'});await waitFor(()=>f.calls().length===1);
  const second=await f.run({TEST_NOW:String(NOW+120001),TEST_CENTS:'67890'});
  assert.equal(second.code,0,second.err);assert.equal(f.calls().length,2);
  fs.writeFileSync(path.join(f.dir,'release'),'1');const expired=await first;
  assert.equal(expired.code,2);assert.match(expired.err,/同步.*过期|租约|所有权/);
  const db=f.db();assert.equal(db.prepare("SELECT revenue FROM site_daily WHERE day='2026-11-17'").get().revenue,678.9);assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteError'").get().value,'');db.close();
});

test('changing or disabling the shop during an awaited snapshot cannot bind or write its old data', async t => {
  for (const mode of ['disable', 'switch']) await t.test(mode, async t => {
    const f=fixture(t),pending=f.run({TEST_WAIT:'1'});await waitFor(()=>f.calls().length===1);
    const file=path.join(f.dir,'config.json'),cfg=JSON.parse(fs.readFileSync(file));
    if(mode==='disable')cfg.site.enabled=false;else cfg.site.shopName='另一个店铺';
    fs.writeFileSync(file,JSON.stringify(cfg));fs.writeFileSync(path.join(f.dir,'release'),'1');
    const result=await pending;assert.equal(result.code,2);assert.match(result.err,/站点.*变更|已停用|配置.*变更/);
    const db=f.db();assert.equal(db.prepare('SELECT count(*) n FROM site_daily').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM site_orders').get().n,0);assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteShopName'").get(),undefined);db.close();
  });
});

test('a dashboard settings reload during a sales sync keeps the same shop', async t => {
  const f = fixture(t);
  const result = await f.run({ TEST_RELOAD: '1' });
  assert.equal(result.code, 0, result.err);
  const db = f.db();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_daily').get().n, 31);
  db.close();
});
