import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('sales scheduler fetches full history once daily, throttles success and failure, and respects shutdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-sales-schedule-'));
  try {
    fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ rootPath: dir, site: { name: '小鹅通', provider: 'xiaoe', shopName: '测试店铺', refundQuery: {page_id:'pi_example',condition_data:{dimension:[{field_id:'test_date'}],metric:[{customizeName:'退款金额',field_id:'test_amount'}],filters:[{field_id:'test_date',filter_operation:'between'}]}}, base: 'https://admin.xiaoe-tech.com', adminPath: '/merchant' } }));
    fs.writeFileSync(path.join(dir, 'src/driver.mjs'), `
      import vm from 'node:vm';
      export const calls=[];export const requests=[];
      export const withTab=async(url,run)=>{calls.push(url);return run(1)};
      const day=(time)=>new Date(time+8*3600000).toISOString().slice(0,10);
      export async function evaluate(tab,expression){
        return vm.runInNewContext(expression,{
          location:{origin:'https://admin.xiaoe-tech.com',href:'https://admin.xiaoe-tech.com/merchant'},AbortSignal,
          fetch:async(endpoint,options)=>{
            requests.push({endpoint,body:options.body});if(globalThis.salesFail)throw new Error('network failed');
            let body;
            if(endpoint==='/xe.merchant-serve.shop_info.get/1.0.0')body={code:0,data:{shop_name:'测试店铺'}};
            else if(endpoint==='/data_analysis/get_overview_data')body={code:0,data:{today_data:{income:0,realIncome:12345,order_count:3,pay_count:2,uv:10}}};
            else if(endpoint==='/data_analysis/get_core_day_trend')body={code:0,data:Object.fromEntries(Array.from({length:30},(_,i)=>{
              const date=day(Date.now()-(30-i)*86400000);return[date,{date,data:{order_count:2,pay_money:10001,refund_money:1201,pay_users:1,uv:20}}];
            }))};
            else if(endpoint.includes('/xe.data.bi_data.data_query/'))body={code:0,data:{result:{dimension:[[{field_id:'test_date',value:day(Date.now())}]],metric:[[{field_id:'test_amount',value:'1.01'}]]}}};
            else if(endpoint.includes('/xe.transaction.ocs.order_list/'))body={code:0,data:{order_list:[{order_id:'o_1',actual_fee:12345,order_state:4,pay_state:1,create_at:day(Date.now())+' 11:00:00',goods_list:[{goods_name:'课程',aftersale_show_state:0}],phone:'private phone',user_info:{name:'private name'}}]}};
            else throw new Error('unexpected endpoint '+endpoint);
            return{ok:true,json:async()=>body};
          }
        },{timeout:1000});
      }
    `);
    fs.writeFileSync(path.join(dir, 'verify.mjs'), `
      import assert from 'node:assert/strict';
      let now=Date.parse('2026-11-17T04:00:00Z');const RealDate=Date;
      globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}};
      const {syncSalesIfDue}=await import('./src/board.mjs');const {db,getMeta}=await import('./src/db.mjs');
      const {calls,requests}=await import('./src/driver.mjs');const {config}=await import('./src/feishu.mjs');const {refreshSite}=await import('./src/site.mjs');
      const historyCalls=()=>requests.filter(r=>r.endpoint==='/data_analysis/get_core_day_trend').length;
      await syncSalesIfDue(now);assert.equal(calls.length,1);assert.equal(historyCalls(),1);assert.equal(getMeta('siteHistoryDay'),'2026-11-17');assert.equal(db.prepare('SELECT count(*) n FROM site_daily').get().n,31);
      const first=db.prepare('SELECT * FROM site_daily WHERE day=?').get('2026-11-17');assert.equal(first.orders,3);assert.equal(first.revenue,123.45);assert.equal(first.refund,1.01);
      const order=db.prepare('SELECT * FROM site_orders').get();assert.deepEqual(Object.keys(order).sort(),['amount','id','kind','status','time','title']);assert.equal(JSON.stringify(order).includes('private'),false);
      now+=599999;assert.equal(await syncSalesIfDue(now),null);assert.equal(calls.length,1);
      now++;await syncSalesIfDue(now);assert.equal(calls.length,2);assert.equal(historyCalls(),1);
      now+=600000;await Promise.all([syncSalesIfDue(now),syncSalesIfDue(now)]);assert.equal(calls.length,3);assert.equal(historyCalls(),1);
      const before=db.prepare('SELECT * FROM site_daily ORDER BY day').all(),success=getMeta('siteLiveSyncedAt');
      now+=600000;globalThis.salesFail=true;await assert.rejects(syncSalesIfDue(now));assert.equal(calls.length,4);assert.deepEqual(db.prepare('SELECT * FROM site_daily ORDER BY day').all(),before);assert.equal(getMeta('siteLiveSyncedAt'),success);
      now++;assert.equal(await syncSalesIfDue(now),null);assert.equal(calls.length,4);globalThis.salesFail=false;
      now=Date.parse('2026-11-17T16:10:00Z');await syncSalesIfDue(now);assert.equal(calls.length,5);assert.equal(historyCalls(),2);assert.equal(getMeta('siteHistoryDay'),'2026-11-18');
      assert.equal(db.prepare('SELECT orders FROM site_daily WHERE day=?').get('2026-11-17').orders,2);assert.equal(db.prepare('SELECT orders FROM site_daily WHERE day=?').get('2026-11-18').orders,3);
      const snapshot=db.prepare('SELECT * FROM site_daily ORDER BY day').all();config.site.enabled=false;refreshSite();now+=600000;
      assert.equal(await syncSalesIfDue(now),null);assert.equal(calls.length,5);assert.deepEqual(db.prepare('SELECT * FROM site_daily ORDER BY day').all(),snapshot);db.close();
    `);
    const result = spawnSync(process.execPath, [path.join(dir, 'verify.mjs')], { cwd: dir, env: { ...process.env, MAITIAN_CONFIG: path.join(dir, 'config.json'), MAITIAN_DB: path.join(dir, 'hub.db'), NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
