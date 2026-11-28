const MIN = 60000, DAY = 1440 * MIN, SHANGHAI = 480 * MIN;
const jobs = ['sales', 'daemon'];
const waiting = new Set();

function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function normalizeRule(rule) {
  if (rule?.mode === 'interval' && hasKeys(rule, ['mode', 'minutes']) &&
      Number.isInteger(rule.minutes) && rule.minutes >= 1 && rule.minutes <= 1440) {
    return { mode: 'interval', minutes: rule.minutes };
  }
  if (rule?.mode === 'daily' && hasKeys(rule, ['mode', 'times']) && Array.isArray(rule.times) &&
      rule.times.length > 0 && rule.times.length <= 1440 &&
      rule.times.every(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
      new Set(rule.times).size === rule.times.length) {
    return { mode: 'daily', times: [...rule.times].sort() };
  }
  throw new Error('请输入 1–1440 的整数分钟，或不重复的 24 小时时刻（HH:MM）');
}

export function normalizeSchedules(value) {
  if (value === undefined) return { sales: { mode: 'interval', minutes: 60 }, daemon: { mode: 'interval', minutes: 60 } };
  if (!hasKeys(value, jobs)) throw new Error('需同时设置小鹅通同步和守护检查');
  return { sales: normalizeRule(value.sales), daemon: normalizeRule(value.daemon) };
}

function shanghaiMidnight(time) {
  return Math.floor((time + SHANGHAI) / DAY) * DAY - SHANGHAI;
}

export function nextSlot(rule, after) {
  if (rule.mode === 'interval') return after + rule.minutes * MIN;
  const midnight = shanghaiMidnight(after);
  const timeOffset = time => (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * MIN;
  for (const time of rule.times) {
    const slot = midnight + timeOffset(time);
    if (slot > after) return slot;
  }
  return midnight + DAY + timeOffset(rule.times[0]);
}

// The last daily cutoff can fall yesterday for a user who only checks in the morning.
export function latestDailyDay(hour, now = Date.now()) {
  const date = new Date(now + SHANGHAI - hour * 60 * MIN);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()].join('/');
}

export function eveningCheckDue(publish, now, nextSweep) {
  const hoursLeft = (publish - now) / (60 * MIN);
  if (!(hoursLeft >= 6 && hoursLeft <= 30)) return false;
  const evening = shanghaiMidnight(publish) - 4 * 60 * MIN;
  return now >= evening || nextSweep >= publish - 6 * 60 * MIN;
}

// If the daily sweep narrowly precedes the five-minute grace period, its next
// sweep can be over 24h later. Give that episode one eligible link lookup.
export function linkCheckDue(schedule, created, previous, now) {
  const anchor = schedule || created, eligible = schedule ? schedule + 5 * MIN : created;
  return now >= eligible && now < created + 14 * DAY && (now < anchor + DAY || !(previous >= eligible));
}

export function notifyScheduleChange() {
  for (const wake of waiting) wake();
}

export function waitUntil(target) {
  return new Promise(resolve => {
    let timer;
    function wake() { clearTimeout(timer); waiting.delete(wake); resolve(); }
    waiting.add(wake);
    if (Number.isFinite(target)) timer = setTimeout(wake, Math.max(0, target - Date.now()));
  });
}
