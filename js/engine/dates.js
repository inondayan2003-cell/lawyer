// כלי תאריכים. כל התאריכים הם "תאריך בלבד" ב-UTC, כדי שלא יהיו הפתעות של אזורי זמן.

const DAY_MS = 86400000;

export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** 'YYYY-MM-DD' -> Date (UTC), או null אם לא תקין */
export function parseISO(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export const toISO = (d) => d.toISOString().slice(0, 10);

export const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

/** חוק הפרשנות סעיף 10(ב): מסתיים ביום שמספרו כמספר יום האירוע, או ביום האחרון של חודש קצר */
export function addMonths(d, months) {
  const total = d.getUTCMonth() + months;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

export const diffDays = (a, b) => Math.round((a.getTime() - b.getTime()) / DAY_MS);

const pad = (n) => String(n).padStart(2, '0');

/** DD.MM.YYYY */
export const fmt = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

/** DD.MM.YYYY (יום X) */
export const fmtLong = (d) => `${fmt(d)} (יום ${HE_DAYS[d.getUTCDay()]})`;

/** סעיף 10(ג) לחוק הפרשנות: יום אחרון שיוצא בשבת עובר ליום ראשון. חגים לא נבדקים. */
export function legalDeadline(raw) {
  if (raw.getUTCDay() === 6) return { date: addDays(raw, 1), moved: true };
  return { date: raw, moved: false };
}

/** התאריך של היום לפי השעון המקומי של המשתמש, כ-Date ב-UTC */
export function todayUTC(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
