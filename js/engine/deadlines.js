// מחשבון מסלול ומועדים. תרגום נאמן של scripts/deadlines.py מהסקיל.
// מקורות: references/fines.md ו-evidence.json בסקיל.

import { addDays, addMonths, diffDays, fmt, legalDeadline, parseISO, toISO } from './dates.js';

export const STAGE1 = parseISO('2026-02-08'); // חוק הפרות תעבורה מינהליות, יום התחילה
export const STAGE2 = parseISO('2026-08-08'); // סעיף 47(ג)(2)
export const FINE_LEVELS = [100, 250, 500, 750, 1000, 1500];

const CANCEL_DAYS = 30;
const OTHER_DRIVER_DAYS = 90;
const SECOND_DAYS = 90;
const PAY_DAYS = 90;
const MAIL_PRESUMPTION_DAYS = 15;

export const TYPE_LABEL = {
  parking: 'דוח חניה עירוני',
  police: 'דוח תנועה (שוטר)',
  camera: 'דוח מצלמה',
  natz: 'דוח נת"צ (נתיב תחבורה ציבורית)',
};

export const TRACK_LABEL = {
  criminal: 'מסלול פלילי',
  admin: 'מסלול מנהלי',
  unknown: 'לא ברור (מוצגים שני המסלולים)',
};

/** איזה מסלול חל, לפי סוג הדוח, תאריך העבירה וסכום הקנס (סעיפים 47(ג), 48(א)) */
export function decideTrack({ type, offence, fine, speeding }) {
  if (type === 'parking') {
    return { track: 'criminal', reason: 'דוח חניה עירוני נשאר במסלול הפלילי (בקשה לביטול, ואחריה בקשה להישפט). בית הדין לתעבורה לא דן בחניה עירונית.' };
  }
  if (type === 'natz') {
    if (offence >= STAGE1) return { track: 'admin', reason: 'נת"צ (500 ₪) עבר למסלול המנהלי לעבירות מ-08.02.2026.' };
    return { track: 'criminal', reason: 'העבירה הייתה לפני 08.02.2026, ולכן היא נשארת במסלול הפלילי (סעיף 48(א)).' };
  }
  if (offence < STAGE1) {
    return { track: 'criminal', reason: 'העבירה הייתה לפני 08.02.2026, ולכן היא במסלול הפלילי (סעיף 48(א)).' };
  }
  if (fine != null && !FINE_LEVELS.includes(fine)) {
    return { track: 'unknown', reason: `הסכום ${fine} ₪ אינו אחת מדרגות הקנס בחוק (100, 250, 500, 750, 1,000, 1,500). בדקו בדוח איזה מסלול כתוב בו.` };
  }
  if (offence < STAGE2) {
    if (speeding) return { track: 'criminal', reason: 'עבירת מהירות לפני 08.08.2026 נשארת במסלול הפלילי.' };
    if (fine == null) return { track: 'unknown', reason: 'בין 08.02.2026 ל-07.08.2026 המסלול תלוי בסכום: 100-500 ₪ מנהלי, 750-1,500 ₪ פלילי. חסר סכום הקנס.' };
    if (fine <= 500) return { track: 'admin', reason: 'קנס של 100-500 ₪ (לא מהירות) עבר למסלול המנהלי מ-08.02.2026.' };
    return { track: 'criminal', reason: 'קנס של 750-1,500 ₪ עבר למסלול המנהלי רק מ-08.08.2026, והעבירה הייתה לפני כן.' };
  }
  return { track: 'admin', reason: 'מ-08.08.2026 כל דרגות הקנס (100-1,500 ₪) ועבירות המהירות במסלול המנהלי.' };
}

/** מגבלת הזמן לשליחת הדוח (סעיף 225א / סעיף 6). החוק סופר עד יום המשלוח. */
export function limitationFlag({ type, offence, sent, served }) {
  const camera = type === 'camera' || type === 'natz';
  const limitEnd = addMonths(offence, camera ? 4 : 12);
  const label = camera ? '4 חודשים' : 'שנה';
  const source = camera
    ? 'סעיף 225א(א1)(1) לחוק סדר הדין הפלילי / סעיף 6(ב)(1) לחוק הפרות תעבורה מינהליות'
    : 'סעיף 225א(א) לחוק סדר הדין הפלילי / סעיף 6(א) לחוק הפרות תעבורה מינהליות';
  const flag = { label, limitEnd, source, level: null, message: null };
  if (sent && sent > limitEnd) {
    flag.level = 'strong';
    flag.message = `הדוח נשלח ב-${fmt(sent)}, אחרי שעברו ${label} מהעבירה (המגבלה הסתיימה ב-${fmt(limitEnd)}).`;
  } else if (!sent && served > limitEnd) {
    flag.level = 'medium';
    flag.message = `הדוח הגיע אחרי שעברו ${label} מהעבירה. החוק סופר עד יום המשלוח, לא עד יום הקבלה, אז צריך לבדוק את תאריך המשלוח שמודפס על הדוח או על המעטפה. אם נשלח אחרי ${fmt(limitEnd)}, הטענה חזקה.`;
  }
  return flag;
}

/**
 * חישוב מלא.
 * input: { type, offence, served, sent, fine, speeding, printedTrack ('auto'|'criminal'|'admin'), today }
 * תאריכים כ-'YYYY-MM-DD'. served לא חובה אם יש sent (חזקת מסירה של 15 יום).
 */
export function computeDeadlines(input) {
  const offence = parseISO(input.offence);
  if (!offence) throw new Error('חסר תאריך עבירה תקין.');
  const sent = parseISO(input.sent);
  let served = parseISO(input.served);
  let presumed = false;
  if (!served) {
    if (!sent) throw new Error('חסר תאריך שבו הדוח הגיע אליכם (או לפחות תאריך המשלוח שעל הדוח).');
    served = addDays(sent, MAIL_PRESUMPTION_DAYS);
    presumed = true;
  }
  if (served < offence) throw new Error('תאריך קבלת הדוח מוקדם מתאריך העבירה. בדקו את התאריכים.');
  const today = parseISO(input.today);
  const fine = input.fine === '' || input.fine == null || Number.isNaN(Number(input.fine)) ? null : Number(input.fine);

  const computed = decideTrack({ type: input.type, offence, fine, speeding: !!input.speeding });
  let { track, reason } = computed;
  let printedConflict = null;
  const printed = input.printedTrack && input.printedTrack !== 'auto' ? input.printedTrack : null;
  if (printed) {
    if (computed.track !== 'unknown' && computed.track !== printed) {
      printedConflict = `לפי החישוב שלנו זה ${TRACK_LABEL[computed.track]}, אבל על הדוח כתוב ${TRACK_LABEL[printed]}. מה שמודפס על הדוח הוא הראיה הכי טובה, ולכן הלכנו לפיו. כדאי לבדוק שוב.`;
    }
    track = printed;
    reason = `לפי מה שמודפס על הדוח (${printed === 'admin' ? '"השגה"' : '"בקשה לביטול"'}). ${computed.reason}`;
  }

  const item = (key, name, raw, note) => {
    const { date, moved } = legalDeadline(raw);
    return { key, name, raw, deadline: date, moved, daysLeft: today ? diffDays(date, today) : null, note };
  };

  const tracks = track === 'unknown' ? ['criminal', 'admin'] : [track];
  const plans = {};
  for (const t of tracks) {
    const criminal = t === 'criminal';
    const first = criminal ? (input.type === 'parking' ? 'בקשה לביטול לעירייה' : 'בקשה לביטול') : 'השגה';
    const second = criminal ? 'בקשה להישפט' : 'ערר לבית הדין לתעבורה';
    const firstSrc = criminal ? 'סעיף 229(א)(1) לחוק סדר הדין הפלילי' : 'סעיף 8(א) לחוק הפרות תעבורה מינהליות';
    const secondSrc = criminal ? 'סעיף 229(א)' : 'סעיף 19(ב)';
    const surcharge = criminal
      ? 'תוספת פיגור, ריבית ודמי פיגורים (סעיף 229(ב))'
      : 'תוספת פיגור של 30% מהקנס, ועוד ריבית והצמדה (סעיף 10(ב))';
    plans[t] = {
      firstStep: first,
      secondStep: second,
      firstSource: firstSrc,
      items: [
        item('first', first, addDays(served, CANCEL_DAYS), `30 יום מהיום שהדוח הגיע (${firstSrc})`),
        item('otherDriver', 'הסבה לנהג אחר (אם מישהו אחר נהג)', addDays(served, OTHER_DRIVER_DAYS), `90 יום מהיום שהדוח הגיע (${firstSrc})`),
        item('second', second, addDays(served, SECOND_DAYS), `90 יום מהיום שהדוח הגיע. אם כבר הגשתם ${first}: 30 יום מההודעה על ההחלטה (${secondSrc})`),
        item('pay', 'תשלום בלי תוספת פיגור', addDays(served, PAY_DAYS), `90 יום מהיום שהדוח הגיע. אחרי זה: ${surcharge}`),
      ],
    };
  }

  return {
    type: input.type,
    typeLabel: TYPE_LABEL[input.type],
    offence, sent, served, presumed, today,
    track, trackReason: reason, printedConflict,
    plans,
    limitation: limitationFlag({ type: input.type, offence, sent, served }),
    notes: [
      ...(presumed ? [`לא ציינתם מתי הדוח הגיע. לפי החוק, דוח שנשלח בדואר רשום נחשב שהגיע 15 יום אחרי המשלוח: ${fmt(served)}.`] : []),
      'הגשת בקשה או השגה לא עוצרת את מועד התשלום. כשתגיע ההחלטה, בדקו בה את מועד התשלום החדש.',
      'היום שבו הדוח הגיע לא נספר. יום אחרון שיוצא בשבת עובר ליום ראשון. חגים לא נבדקים כאן, ולכן עדיף להגיש כמה ימים לפני.',
    ],
  };
}

export { toISO };
