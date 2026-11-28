import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as flush } from 'node:timers/promises';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-clock-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
process.env.MAITIAN_DB = path.join(dir, 'data.db');
fs.writeFileSync(process.env.MAITIAN_CONFIG, '{}');
const { config } = await import('../src/feishu.mjs');
const { db, setMeta } = await import('../src/db.mjs');
const { normalizeSchedules, nextSlot, latestDailyDay, eveningCheckDue, linkCheckDue, notifyScheduleChange } = await import('../src/schedules.mjs');
const { watchScheduleFile, scheduleDeadline, runIfDue, watchSchedule } = await import('../src/schedule-runtime.mjs');
const at = (day, time) => Date.parse('2026-11-' + day + 'T' + time + ':00+08:00');
const daily = (...times) => ({ mode: 'daily', times });

beforeEach(() => { delete config.schedules; db.exec('DELETE FROM meta'); });
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('clock slots use Shanghai time, cross midnight, and require valid distinct minutes', () => {
  const rules = normalizeSchedules({ sales: daily('23:03', '00:01'), daemon: { mode: 'interval', minutes: 1 } });
  assert.deepEqual(rules.sales, daily('00:01', '23:03'));
  assert.equal(nextSlot(rules.sales, at(24, '23:03')), at(25, '00:01'));
  assert.deepEqual(normalizeSchedules().daemon, { mode: 'interval', minutes: 60 });
  for (const rule of [daily(), daily('24:00'), daily('08:60'), daily('08:00', '08:00'), { mode: 'interval', minutes: 1441 },
    { mode: 'interval', minutes: '60' }, { mode: 'interval', minutes: 0.5 }, { mode: 'daily', times: ['08:00'], extra: 1 }]) {
    assert.throws(() => normalizeSchedules({ ...rules, sales: rule }));
  }
});

test('a restart after missed slots runs once and preserves the next precise time', async t => {
  config.schedules = { sales: daily('08:00','09:00'), daemon: daily('23:00') };
  let now = at(24, '08:30'), calls = 0;
  t.mock.method(Date, 'now', () => now);
  assert.equal(scheduleDeadline('sales'), at(24, '09:00'));
  assert.equal(await runIfDue('sales', () => ++calls), null);
  now = at(26, '08:15');
  const restarted = await import('../src/schedule-runtime.mjs?restart');
  assert.equal(await restarted.runIfDue('sales', () => ++calls), 1);
  assert.equal(await restarted.runIfDue('sales', () => ++calls), null);
  assert.equal(scheduleDeadline('sales'), at(26, '09:00'));
  assert.equal(scheduleDeadline('daemon'), at(26, '23:00'));
});

test('slow interval runs skip covered periods and remain anchored to their start', async t => {
  let now = at(24, '02:05');
  t.mock.method(Date, 'now', () => now);
  await runIfDue('daemon', async () => { now = at(24, '04:39'); });
  assert.equal(scheduleDeadline('daemon'), at(24, '05:05'));
});

test('daily cutoffs and pre-publication login checks survive morning-only sweeps', () => {
  assert.equal(latestDailyDay(10, at(24, '07:30')), '2026/11/23');
  assert.equal(latestDailyDay(9, at(24, '09:00')), '2026/11/24');
  const publish = at(25, '10:00'), morning = at(24, '07:30');
  assert.equal(eveningCheckDue(publish, morning, morning + 3600000), false);
  assert.equal(eveningCheckDue(publish, morning, at(25,'07:30')), true);
  assert.equal(eveningCheckDue(publish, at(24, '20:00'), at(24,'21:00')), true);
});

test('a once-daily sweep just before link eligibility can retrieve it the next day only once', () => {
  const created = at(23, '10:00'), schedule = at(24, '09:58'), next = at(25, '10:00');
  assert.equal(linkCheckDue(schedule, created, 0, at(24, '10:00')), false);
  assert.equal(linkCheckDue(schedule, created, 0, next), true);
  assert.equal(linkCheckDue(schedule, created, next, at(26, '10:00')), false);
  assert.equal(linkCheckDue(at(5, '08:00'), at(3, '08:00'), 0, next), false);
});

test('an atomic external config save wakes a sleeping schedule in the daemon process', async t => {
  const configFile = process.env.MAITIAN_CONFIG;
  const now = at(24, '13:00');
  t.mock.method(Date, 'now', () => now);
  const previous = { sales: daily('17:00'), daemon: daily('18:00') };
  fs.writeFileSync(configFile, JSON.stringify({ schedules: previous }));
  const fileWatcher = watchScheduleFile();
  let enabled = true, started;
  const job = new Promise(resolve => { started = resolve; });
  watchSchedule('sales', () => enabled, () => { enabled = false; started(); }, err => { throw err; });
  try {
    assert.deepEqual(config.schedules, previous);
    const next = { ...previous, sales: daily('13:00') };
    const tmp = path.join(dir, 'new-config');
    fs.writeFileSync(tmp, JSON.stringify({ schedules: next }));
    fs.renameSync(tmp, configFile);
    const timeout = setTimeout(() => started('timed out'), 2000);
    try { assert.equal(await job, undefined); } finally { clearTimeout(timeout); }
    assert.deepEqual(config.schedules, next);
  } finally {
    fileWatcher.close(); enabled = false; notifyScheduleChange(); await flush();
    fs.writeFileSync(configFile, '{}');
  }
});

test('saving clock times re-arms sleeping jobs; a slow sales refresh never holds the daemon timer', async t => {
  const start = at(24, '09:00');
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: start });
  config.schedules = { sales: { mode: 'interval', minutes: 60 }, daemon: daily('09:02') };
  setMeta('siteSalesAttempt', start);
  const calls = [], errors = [];
  let enabled = true, finishSales;
  const running = new Promise(resolve => { finishSales = resolve; });
  const watch = (name, work) => watchSchedule(name, () => enabled, work, err => errors.push(err));
  watch('sales', async () => { calls.push(['sales', Date.now()]); await running; });
  watch('daemon', () => calls.push(['daemon', Date.now()]));
  config.schedules.sales = daily('09:01','09:02','09:03');
  notifyScheduleChange();
  await flush();
  t.mock.timers.tick(60000);
  await flush();
  assert.deepEqual(calls, [['sales', at(24, '09:01')]]);
  t.mock.timers.tick(60000);
  await flush();
  assert.deepEqual(calls[1], ['daemon', at(24, '09:02')]);
  t.mock.timers.tick(60000);
  finishSales();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(scheduleDeadline('sales'), at(25, '09:01'));
  assert.deepEqual(errors, []);
  enabled = false; notifyScheduleChange();
  await flush();
});
