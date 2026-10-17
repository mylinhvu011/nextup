// Times, time zones and repeating schedules. Workers run in UTC, so anything said in the
// organizer's local time ("ends at 10 PM", "every Tuesday at 7") is worked out with their
// IANA time zone (sent by their browser, e.g. "America/New_York").

export function tzOk(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length < 64; } catch { return false; }
}

const fmtCache = new Map();
function partsIn(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
function offsetAt(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
// Local wall-clock time in `tz` -> UTC milliseconds.
export function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  const o2 = offsetAt(t, tz);
  if (guess - o2 !== t) t = guess - o2; // daylight-saving edge
  return t;
}

export function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? [h, mi] : null;
}
export const localDate = (ms, tz) => { const p = partsIn(ms, tz); return { y: p.y, m: p.m, d: p.d }; };
const dayNum = ({ y, m, d }) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
const fromDayNum = n => { const dt = new Date(n * 864e5); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; };
export const ymd = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const v = { y: +m[1], m: +m[2], d: +m[3] };
  return ymd(fromDayNum(dayNum(v))) === s ? v : null;
}

// When an event that opened at `openedAt` should close, from its settings:
// closeMode 'hours' -> openedAt + closeHours; 'time' -> the next closeTime (local) after it opened.
export function closeAtFor(openedAt, st, testMs) {
  if (st.closeMode === 'time') {
    const hm = parseHM(st.closeTime);
    const tz = tzOk(st.tz) ? st.tz : 'UTC';
    if (hm) {
      let ld = localDate(openedAt, tz);
      for (let i = 0; i < 3; i++) {
        const t = zonedToUtc(ld.y, ld.m, ld.d, hm[0], hm[1], tz);
        if (t > openedAt + 5 * 60000) return t;
        ld = fromDayNum(dayNum(ld) + 1);
      }
    }
  }
  if (testMs) return openedAt + testMs;
  return openedAt + (st.closeHours || 12) * 3600000;
}

/* ---------- repeating schedules ----------
   { days: [0-6] (0 = Sunday), everyWeeks: 1-8, startTime: 'HH:MM', opensBefore: minutes,
     startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' | null }                                   */
export function cleanSchedule(s = {}, tz = 'UTC') {
  const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!days.length) return { error: 'Pick at least one day' };
  const startTime = parseHM(s.startTime) ? s.startTime.padStart(5, '0') : null;
  if (!startTime) return { error: 'Pick a start time' };
  const everyWeeks = Math.min(8, Math.max(1, Math.round(Number(s.everyWeeks) || 1)));
  const opensBefore = Math.min(240, Math.max(0, Math.round(Number(s.opensBefore) || 0)));
  const startDate = parseYmd(s.startDate) ? s.startDate : ymd(localDate(Date.now(), tz));
  let endDate = s.endDate ? (parseYmd(s.endDate) ? s.endDate : undefined) : null;
  if (endDate === undefined) return { error: 'That end date is not valid' };
  if (endDate && endDate < startDate) return { error: 'The end date is before the first week' };
  return { days, everyWeeks, startTime, opensBefore, startDate, endDate };
}

const weekIdx = n => Math.floor((n + 3) / 7); // weeks start on Monday (day 0 = Thu 1 Jan 1970)

// The occurrences of a schedule from the local date of `fromMs` (minus a day, so one that is still
// running is included), up to `count` of them. Each: { date, startAt, openAt }.
export function occurrences(sched, tz, fromMs, count = 6) {
  const out = [];
  const [h, mi] = parseHM(sched.startTime);
  const first = dayNum(parseYmd(sched.startDate));
  const last = sched.endDate ? dayNum(parseYmd(sched.endDate)) : Infinity;
  const firstWeek = weekIdx(first);
  let n = Math.max(first, dayNum(localDate(fromMs, tz)) - 1);
  for (let i = 0; i < 800 && out.length < count && n <= last; i++, n++) {
    const dow = ((n + 4) % 7 + 7) % 7;
    if (!sched.days.includes(dow)) continue;
    if ((weekIdx(n) - firstWeek) % sched.everyWeeks !== 0) continue;
    const ld = fromDayNum(n);
    const startAt = zonedToUtc(ld.y, ld.m, ld.d, h, mi, tz);
    out.push({ date: ymd(ld), startAt, openAt: startAt - sched.opensBefore * 60000 });
  }
  return out;
}

// "Tue, Oct 20 at 6:30 PM" in the organizer's time zone.
export function whenText(ms, tz) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const t = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return `${day} at ${t}`;
}
