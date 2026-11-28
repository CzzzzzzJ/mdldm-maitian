import test from 'node:test';
import assert from 'node:assert/strict';
import { publicBoardUrl, publishTunnelAddress, tunnelBoardUrl } from '../src/tunnel-url.mjs';

test('public address drops the access key and keeps the origin', () => {
  assert.equal(publicBoardUrl('https://mt.example/?key=secret'), 'https://mt.example');
  assert.equal(publicBoardUrl('https://mt.example/board?key=secret&x=1'), 'https://mt.example/board?x=1');
  assert.equal(publicBoardUrl('https://user:secret@mt.example/#key'), 'https://mt.example');
  assert.equal(publicBoardUrl('javascript:alert(1)'), '');
  assert.equal(tunnelBoardUrl('{"url":"https://old.example/?key=secret","base":"https://old.example/?key=secret"}'), 'https://old.example');
});

test('tunnel file and feishu notice never include the key', async () => {
  const notes = [];
  let saved = null;
  const url = await publishTunnelAddress('https://quick.trycloudflare.com/?key=plain-secret', {
    named: false,
    gated: false,
    readPrev: () => null,
    write: (rec) => { saved = rec; },
    notify: async (text) => { notes.push(text); },
    now: () => '2026-11-27T00:00:00.000Z',
  });
  assert.equal(url, 'https://quick.trycloudflare.com');
  assert.equal(saved.url, url);
  assert.equal(saved.base, url);
  assert.equal(JSON.stringify(saved).includes('plain-secret'), false);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].includes('plain-secret'), false);
  assert.match(notes[0], /不含口令/);

  const gated = [];
  await publishTunnelAddress('https://maitian.example/?key=plain-secret', {
    named: true,
    gated: true,
    readPrev: () => null,
    write: () => {},
    notify: async (text) => { gated.push(text); },
  });
  assert.equal(gated[0].includes('plain-secret'), false);
  assert.equal(gated[0].includes('不含口令'), false);
  assert.match(gated[0], /https:\/\/maitian\.example/);
});
