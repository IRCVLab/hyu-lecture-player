/** Parse an LMS Korean date in Asia/Seoul, rejecting calendar rollover. */
export function parseKoreanDate(text, year) {
  const match = String(text).trim().match(/^(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  const invalid = () => { throw new Error(`Invalid Korean date: ${text}`); };
  if (!match || !Number.isInteger(year) || year < 100 || year > 9999) invalid();
  const [, monthText, dayText, period, hourText, minuteText] = match;
  const [month, day, hour, minute] = [monthText, dayText, hourText, minuteText].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 12 || minute > 59) invalid();
  const localHour = hour % 12 + (period === '오후' ? 12 : 0);
  const local = new Date(Date.UTC(year, month - 1, day, localHour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) invalid();
  return new Date(local.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

function timestamp(value, field, entry) {
  const result = value == null || value === '' ? NaN : new Date(value).getTime();
  if (!Number.isFinite(result)) {
    throw new Error(`Missing or invalid schedule date ${field} for course ${entry.courseId}, week ${entry.week}; check the LMS schedule.`);
  }
  return result;
}

/** Select entire video weeks independently for each course, without mutating entries. */
export function selectEntries(entries, { weeks, now = new Date() } = {}) {
  const current = new Date(now).getTime();
  if (!Number.isFinite(current)) throw new Error('Invalid date for now');
  const explicit = weeks !== undefined;
  if (explicit && (!Array.isArray(weeks) || weeks.length === 0 || weeks.some(week => !Number.isInteger(week) || week < 1))) {
    throw new Error('--weeks must contain positive integer week numbers');
  }
  const courses = new Map();
  for (const entry of entries) {
    if (!courses.has(entry.courseId)) courses.set(entry.courseId, []);
    courses.get(entry.courseId).push(entry);
  }
  const result = [];
  for (const [courseId, rows] of courses) {
    const videos = rows.filter(row => row.kind === 'video');
    let chosen;
    if (explicit) {
      chosen = new Set(weeks);
      for (const week of chosen) {
        if (!rows.some(row => row.week === week)) throw new Error(`Unknown week ${week} in course ${courseId}`);
      }
    } else {
      const active = videos.map(entry => ({ entry,
        start: timestamp(entry.startsAt, 'startsAt', entry),
        due: timestamp(entry.dueAt, 'dueAt', entry),
      })).filter(item => item.start <= current && item.due >= current);
      if (!active.length) continue;
      const latest = Math.max(...active.map(item => item.start));
      chosen = new Set(active.filter(item => item.start === latest).map(item => item.entry.week));
      if (chosen.size !== 1) throw new Error(`Ambiguous current week for course ${courseId}; choose --weeks explicitly.`);
    }
    const selected = videos.filter(row => chosen.has(row.week)).sort((a, b) => a.week - b.week);
    for (const entry of selected) {
      const start = timestamp(entry.startsAt, 'startsAt', entry);
      if (!entry.completed) timestamp(entry.dueAt, 'dueAt', entry);
      if (start > current) throw new Error(`Week ${entry.week} in course ${courseId} starts in the future`);
      if (!entry.completed && timestamp(entry.endsAt, 'endsAt', entry) < current) {
        throw new Error(`Playback end date expired for course ${courseId}, week ${entry.week}`);
      }
    }
    result.push(...selected);
  }
  return result;
}
