import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../src/web/board.html', import.meta.url), 'utf8');
const helpers = html.slice(html.indexOf('const epAt ='), html.indexOf('// —— 粉丝 ——'));
function setup(data) {
  const scope = { O: data, PL: ['bilibili'], Date, daysBack: () => ['2026-11-19', '2026-11-20', '2026-11-21'] };
  return vm.runInNewContext(helpers + '; ({ epAt, gainOf, dayInter, cumPts })', scope);
}
test('独立合并时发布时间回退到排期；缺样本不造增长', () => {
  const h = setup({ metrics: [], samples: [] });
  assert.equal(h.epAt({ schedule: '2026-11-20 09:00' }), Date.parse('2026-11-20T09:00:00+08:00'));
  assert.equal(h.gainOf('sample', h.dayInter), null);
});
test('互动增量按真实快照相减，累计曲线排除停用平台', () => {
  const h = setup({ metrics: [
    { episode_id: 'sample', day: '2026-11-19', platform: 'bilibili', likes: 2, comments: 1 },
    { episode_id: 'sample', day: '2026-11-21', platform: 'bilibili', likes: 5, comments: 2 },
  ], samples: [
    { episode_id: 'sample', platform: 'bilibili', ts: '2026-11-20T02:00', views: 10 },
    { episode_id: 'sample', platform: 'xhs', ts: '2026-11-20T02:00', views: 999 },
  ] });
  assert.equal(h.gainOf('sample', h.dayInter).d, 4);
  assert.equal(h.cumPts('sample', Date.parse('2026-11-20T01:00Z'))[0].v, 10);
});
