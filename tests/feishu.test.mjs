import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-fs-'));
after(() => fs.rmSync(dir, {recursive:true, force:true}));
const testHook = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-bot';
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ name: '麦田', feishuWebhook: 'https://saved' }));

test('成功', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ code: 0 }) });
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu(testHook);
  assert.equal(r.ok, true);
});

test('飞书拒绝', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ code: 19001, msg: 'bad token' }) });
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu(testHook);
  assert.equal(r.ok, false);
  assert.match(r.error, /19001/);
});

test('网络异常', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu(testHook);
  assert.equal(r.ok, false);
  assert.match(r.error, /offline/);
});

test('空 webhook 直接报错', async () => {
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu('');
  assert.equal(r.ok, false);
  assert.match(r.error, /webhook/);
});

test('非飞书地址不会发送，HTTP 或无确认的响应不能报告发送成功', async () => {
  const {testFeishu} = await import('../src/feishu.mjs');
  let calls=0; globalThis.fetch=async()=>{calls++;return {ok:false,status:401,json:async()=>({})};};
  assert.equal((await testFeishu('https://unrelated.invalid/test')).ok,false); assert.equal(calls,0);
  assert.match((await testFeishu(testHook)).error,/401/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({})});
  assert.equal((await testFeishu(testHook)).ok,false);
});
