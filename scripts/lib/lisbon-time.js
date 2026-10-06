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

function lisbonDayStartIso(dayKey) {
  const ms = hourKeyToUtcMs(`${dayKey}T00`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function lisbonDayEndExclusiveIso(dayKey) {
  const next = addLisbonDays(dayKey, 1);
  return lisbonDayStartIso(next);
}

const LISBON_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/;

function parseLisbonLocalParts(value) {
  const match = String(value || '').trim().match(LISBON_LOCAL_RE);
  if (!match) return null;
  return {
    day: match[1],
    hour: match[2] != null ? Number(match[2]) : 0,
    minute: match[3] != null ? Number(match[3]) : 0,
    second: match[4] != null ? Number(match[4]) : 0,
    hasTime: match[2] != null,
    hasMinute: match[3] != null,
    hasSecond: match[4] != null,
  };
}

function lisbonLocalToUtcIso(value) {
  const parts = parseLisbonLocalParts(value);
  if (!parts) return null;
  const hourKey = `${parts.day}T${String(parts.hour).padStart(2, '0')}`;
  const hourStart = hourKeyToUtcMs(hourKey);
  if (!Number.isFinite(hourStart)) return null;
  return new Date(hourStart + parts.minute * 60000 + parts.second * 1000).toISOString();
}

function lisbonCreatedFromIso(value) {
  const parts = parseLisbonLocalParts(value);
  if (!parts) return null;
  if (!parts.hasTime) return lisbonDayStartIso(parts.day);
  return lisbonLocalToUtcIso(value);
}

function lisbonCreatedToExclusiveIso(value) {
  const parts = parseLisbonLocalParts(value);
  if (!parts) return null;
  if (!parts.hasTime) return lisbonDayEndExclusiveIso(parts.day);
  if (parts.hour === 0 && parts.minute === 0 && parts.second === 0) {
    return lisbonDayEndExclusiveIso(parts.day);
  }
  const startMs = Date.parse(lisbonLocalToUtcIso(value));
  if (!Number.isFinite(startMs)) return null;
  if (parts.hasSecond) return new Date(startMs + 1000).toISOString();
  if (parts.hasMinute) return new Date(startMs + 60000).toISOString();
  return new Date(startMs + 3600000).toISOString();
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
  addLisbonDays,
  lisbonDayStartIso,
  lisbonDayEndExclusiveIso,
  lisbonLocalToUtcIso,
  lisbonCreatedFromIso,
  lisbonCreatedToExclusiveIso,
  buildDailySeries,
  buildHourlySeries,
  buildStackedDailySeries,
  buildStackedHourlySeries,
  buildDailySeriesBetween,
  buildStackedDailySeriesBetween,
};
