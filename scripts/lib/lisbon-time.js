const LISBON_TZ = 'Europe/Lisbon';

function toLisbonDayKey(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: LISBON_TZ });
}

function toLisbonHourKey(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}`;
}

function lisbonTodayKey() {
  return toLisbonDayKey(new Date());
}

function hourKeyToUtcMs(key) {
  if (!key || !String(key).includes('T')) return NaN;
  const [datePart, hourPart] = String(key).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const hour = Number(hourPart);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  for (const offsetHours of [-2, -1, 0, 1, 2]) {
    const probe = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, 0, 0, 0));
    const parts = formatter.formatToParts(probe);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const probeKey = `${map.year}-${map.month}-${map.day}T${map.hour}`;
    if (probeKey === key) return probe.getTime();
  }
  return Date.UTC(year, month - 1, day, hour, 0, 0, 0);
}

function dayKeyToUtcMs(dayKey) {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return NaN;
  const [year, month, day] = dayKey.split('-').map(Number);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  for (const offsetHours of [-14, -12, -10, -8]) {
    const probe = new Date(Date.UTC(year, month - 1, day, 12 + offsetHours, 0, 0, 0));
    const parts = formatter.formatToParts(probe);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const probeKey = `${map.year}-${map.month}-${map.day}`;
    if (probeKey === dayKey) return probe.getTime();
  }
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
}

function addLisbonDays(dayKey, deltaDays) {
  const ms = dayKeyToUtcMs(dayKey);
  if (!Number.isFinite(ms)) return dayKey;
  return toLisbonDayKey(new Date(ms + deltaDays * 86400000));
}

function buildHourKeysEndingNow(hours) {
  const keys = [];
  let key = toLisbonHourKey(new Date());
  for (let i = 0; i < hours; i += 1) {
    keys.unshift(key);
    if (i < hours - 1) {
      const ms = hourKeyToUtcMs(key);
      key = toLisbonHourKey(new Date(ms - 3600000));
    }
  }
  return keys;
}

function buildDayKeysEndingToday(days) {
  const keys = [];
  let key = toLisbonDayKey(new Date());
  for (let i = 0; i < days; i += 1) {
    keys.unshift(key);
    if (i < days - 1) key = addLisbonDays(key, -1);
  }
  return keys;
}

function buildDayKeysBetween(dateFrom, dateTo) {
  const keys = [];
  let key = dateFrom;
  while (key <= dateTo) {
    keys.push(key);
    if (key === dateTo) break;
    key = addLisbonDays(key, 1);
  }
  return keys;
}

function buildDailySeries(byDay, days = 14) {
  return buildDayKeysEndingToday(days).map((key) => ({
    key,
    count: byDay[key] || 0,
  }));
}

function buildHourlySeries(byHour, hours = 24) {
  return buildHourKeysEndingNow(hours).map((key) => ({
    key,
    count: byHour[key] || 0,
  }));
}

function buildStackedDailySeries(byDayByBucket, days = 14, sumFn) {
  const sum = sumFn || ((bucket) => Object.values(bucket || {}).reduce((total, value) => total + value, 0));
  return buildDayKeysEndingToday(days).map((key) => {
    const byIssue = byDayByBucket[key] || {};
    return { key, byIssue, count: sum(byIssue) };
  });
}

function buildStackedHourlySeries(byHourByBucket, hours = 24, sumFn) {
  const sum = sumFn || ((bucket) => Object.values(bucket || {}).reduce((total, value) => total + value, 0));
  return buildHourKeysEndingNow(hours).map((key) => {
    const byIssue = byHourByBucket[key] || {};
    return { key, byIssue, count: sum(byIssue) };
  });
}

function buildDailySeriesBetween(byDay, dateFrom, dateTo) {
  return buildDayKeysBetween(dateFrom, dateTo).map((key) => ({
    key,
    count: byDay[key] || 0,
  }));
}

function buildStackedDailySeriesBetween(byDayByBucket, dateFrom, dateTo, sumFn) {
  const sum = sumFn || ((bucket) => Object.values(bucket || {}).reduce((total, value) => total + value, 0));
  return buildDayKeysBetween(dateFrom, dateTo).map((key) => {
    const byIssue = byDayByBucket[key] || {};
    return { key, byIssue, count: sum(byIssue) };
  });
}

module.exports = {
  LISBON_TZ,
  toLisbonDayKey,
  toLisbonHourKey,
  lisbonTodayKey,
  buildDailySeries,
  buildHourlySeries,
  buildStackedDailySeries,
  buildStackedHourlySeries,
  buildDailySeriesBetween,
  buildStackedDailySeriesBetween,
};
