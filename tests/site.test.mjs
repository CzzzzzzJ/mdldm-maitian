import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-site-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ name: '麦田' }));

const { config } = await import('../src/feishu.mjs');
const { siteEnabled, refreshSite } = await import('../src/site.mjs');

test('启用判定', () => {
  assert.equal(siteEnabled(null), false);
  assert.equal(siteEnabled({}), false);
  assert.equal(siteEnabled({ name: 'x' }), false);          // 没有 base
  assert.equal(siteEnabled({ base: 'https://a.com' }), true);
  assert.equal(siteEnabled({ base: 'https://a.com', enabled: true }), true);
  assert.equal(siteEnabled({ base: 'https://a.com', enabled: false }), false);
});

test('refreshSite 跟随 config 变化', () => {
  config.site = { name: '站', base: 'https://a.com/', enabled: true };
  const s = refreshSite();
  assert.equal(s.base, 'https://a.com');                    // 去尾斜杠
  assert.equal(s.admin, 'https://a.com/admin');
  assert.equal(s.coursesApi, '/api/courses?admin=1');
  config.site.enabled = false;
  assert.equal(refreshSite(), null);
});
