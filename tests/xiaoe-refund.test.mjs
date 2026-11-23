import test from 'node:test';
import assert from 'node:assert/strict';

test('BI refund trend maps the dated amount in yuan without treating missing dates as zero', async () => {
  const { parseXiaoeRefund } = await import('../src/xiaoe.mjs');
  const payload = {code:0,data:{result:{dimension:[[{field_id:'test_date',value:'2026-11-17'}]],metric:[[{field_id:'test_amount',value:'79.01'},{field_id:'other',value:4}]]}}};
  assert.equal(parseXiaoeRefund(payload,'2026-11-17','test_date','test_amount'),79.01);
  assert.throws(()=>parseXiaoeRefund(payload,'2026-11-16','test_date','test_amount'));
  for (const value of [null,undefined,'',-1,'1e3','1.999']) {
    payload.data.result.metric[0][0].value=value;
    assert.throws(()=>parseXiaoeRefund(payload,'2026-11-17','test_date','test_amount'));
  }
  assert.throws(()=>parseXiaoeRefund({code:401,data:{}},'2026-11-17','test_date','test_amount'));
});
