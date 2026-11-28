import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { chinaMetricsJs, chinaAccountRowsJs, chinaDetailJs, chinaFansJs } from '../src/china-metrics.mjs';

function read(id, options, rows) {
  const document = { querySelectorAll: () => rows };
  return JSON.parse(JSON.stringify(vm.runInNewContext(chinaMetricsJs(id, options), { document, URL })));
}
const node = (innerText, extra = {}) => ({ innerText, ...extra });
const row = (fields, groups = {}) => ({ getClientRects: () => [1], querySelector: s => fields[s], querySelectorAll: s => groups[s] || [] });

test('A站按公开作品 ID 取数，保留零和弹幕，不把金香蕉当点赞', () => {
  const ac = (id, views) => row({
    '.c-content-title': node('同名作品', { href: 'https://www.acfun.cn/v/ac' + id }),
    '.views': node(views + ' 播放'), '.comments': node('0 评论'), '.danmakuSize': node('3 弹幕'), '.goldBanana': node('999 金香蕉'),
  });
  assert.deepEqual(read('acfun', { url: 'https://www.acfun.cn/v/ac42' }, [ac(12,'99'),ac(42,'1.2万')]), { views:12000, comments:0, extra:{ 弹幕:3 } });
  assert.equal(read('acfun', { url: 'https://www.acfun.cn/v/ac43' }, [ac(42,'0')]), null);
});

test('快手历史作品以视频 ID 去重，不把私密作品放进历史', () => {
  const work = (id, privacy) => Object.assign(row({
    '.video-item__detail__row__status': node('已发布'),
    '.video-item__detail__row__photoStatus': node(privacy),
    '.video-item__detail__row__title': node('作品'),
  }), { __vue__: { $props: { videoInfo: { workId:id, uploadTime:1795752000000, playCount:0 } } } });
  const document = { querySelectorAll: () => [work('abc',''),work('abc',''),work('xxx','私密') ] };
  const actual=vm.runInNewContext(chinaAccountRowsJs('kuaishou'), {document,URL});
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), [{id:'abc',title:'作品',url:'https://www.kuaishou.com/short-video/abc',publishedAt:'2026-11-27T04:00:00.000Z',views:0,extra:{}}]);
});

test('详情只取总览数值；粉丝不把净增当总数', () => {
  const tile = (label, value) => row({'.name':node(label),'.data':node(value),'.dc-piece-item-tip':node(label),'.dc-piece-item-count':node(value)});
  const document={querySelectorAll: () => [tile('收藏量','12'),tile('分享量','0'),tile('粉丝总数','1,234'),tile('净增粉丝量','8')]};
  const run=js=>JSON.parse(JSON.stringify(vm.runInNewContext(js,{document})));
  assert.deepEqual(run(chinaDetailJs()), {favorites:12,shares:0});
  assert.deepEqual(run(chinaFansJs('acfun')), {total:1234,history:[]});
});

test('快手无公开链接的卡片只能按完整文案和已知发布时间匹配，私密不采', () => {
  const metric = (icon, value) => ({ innerText:value, querySelector: () => ({ getAttribute: () => '/static/'+icon+'.abc.svg' }) });
  const ks = (date, privacy = '') => row({
    '.video-item__detail__row__title': node('本期\n完整文案'),
    '.video-item__detail__row__date': node(date),
    '.video-item__detail__row__status': node('已发布'),
    '.video-item__detail__row__photoStatus': node(privacy),
  }, { '.video-item__detail__row__label': [metric('icon-play','1,205'),metric('icon_comment','0'),metric('icon-like','4')] });
  const opt={p:{caption:'本期 完整文案'},publishedAt:'2026-11-27 12:34:55'};
  const good=ks('2026-11-27 12:34');
  assert.deepEqual(read('kuaishou', opt, [ks('2026-11-26 12:34'),good]), {views:1205,comments:0,likes:4});
  assert.equal(read('kuaishou', opt, [good,good]), null);
  assert.equal(read('kuaishou', opt, [ks('2026-11-27 12:34','私密')]), null);
  assert.equal(read('kuaishou', {p:opt.p}, [good]), null);
});
