// בניית המכתבים מתוך התבניות שבסקיל (templates/*.md).

import { fmt, parseISO } from './dates.js';

const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
export const annexName = (i) => `נספח ${HEB_LETTERS[i] || i + 1}'`;

const or = (v, fallback) => (v != null && String(v).trim() !== '' ? String(v).trim() : fallback);
const dateOr = (iso, fallback) => {
  const d = parseISO(iso);
  return d ? fmt(d) : fallback;
};

export function authorityName(details) {
  const city = or(details.city, '');
  if (details.authorityKind === 'police') return 'משטרת ישראל';
  if (!city) return 'העירייה';
  return /^(עיריית|מועצה|המועצה)/.test(city) ? city : `עיריית ${city}`;
}

function recipient(details, track) {
  if (details.authorityKind === 'police') {
    return track === 'admin'
      ? ['לכבוד', 'הגורם המוסמך, מרכז פניות נהגים ארצי', 'משטרת ישראל']
      : ['לכבוד', 'תביעות תעבורה / מרכז פניות נהגים ארצי', 'משטרת ישראל'];
  }
  return ['לכבוד', authorityName(details), 'המחלקה לטיפול בדוחות (בערוץ שמודפס על הדוח)'];
}

function subject(details, track) {
  const n = or(details.ticketNumber, '[מספר הדוח]');
  if (track === 'admin') {
    return `הנדון: השגה על החלטה להטיל קנס, דוח מספר ${n}${details.type === 'natz' ? ' (נתיב תחבורה ציבורית)' : ''}`;
  }
  return details.type === 'parking'
    ? `הנדון: בקשה לביטול דוח חניה מספר ${n}`
    : `הנדון: בקשה לביטול הודעת תשלום קנס מספר ${n}`;
}

function signature(person) {
  return [
    'בכבוד רב,',
    '',
    or(person.name, '[שם מלא]'),
    `ת"ז ${or(person.id, '[מספר ת"ז מלא]')}`,
    `טלפון ${or(person.phone, '[טלפון]')} | מייל ${or(person.email, '[מייל]')}`,
    `כתובת למשלוח דואר: ${or(person.address, '[כתובת]')}`,
    'חתימה: ____________',
  ];
}

/**
 * מכתב הבקשה לביטול / ההשגה.
 * grounds: עד 3 ממצאים שנבחרו למכתב (עם paragraph מוכן או פונקציה).
 */
export function buildAppealLetter({ details, person, track, served, firstDeadline, today, grounds, realPlate }) {
  const lines = [];
  lines.push(`${or(person.city, '[עיר]')}, ${today ? fmt(today) : '[תאריך]'}`, '');
  lines.push(...recipient(details, track), '');
  lines.push(subject(details, track), '');

  const plate = or(realPlate || details.plate, '[מספר רכב]');
  const who = `אני, ${or(person.name, '[שם מלא]')}, ת"ז ${or(person.id, '[מספר ת"ז מלא]')}, בעל/ת הרכב מספר ${plate},`;
  if (track === 'admin') {
    lines.push(`1. ${who} מגיש/ה השגה לפי סעיף 8(א) לחוק הפרות תעבורה מינהליות, התשפ"ד-2024, על הדוח שבנדון.`);
  } else {
    lines.push(`1. ${who} מבקש/ת לבטל את הודעת תשלום הקנס שבנדון, לפי סעיף 229(א)(1) לחוק סדר הדין הפלילי [נוסח משולב], התשמ"ב-1982.`);
  }
  lines.push('');

  const parts = [];
  parts.push(`תאריך ושעה: ${dateOr(details.offenceDate, '[תאריך]')}${details.time ? ` בשעה ${details.time}` : ''}.`);
  parts.push(`מקום: ${or(details.location, '[מקום]')}.`);
  if (details.offenceText) parts.push(`העבירה המיוחסת: ${details.offenceText}.`);
  if (parseISO(details.sentDate)) parts.push(`תאריך המשלוח המודפס על הדוח: ${dateOr(details.sentDate)}.`);
  if (served) {
    const inTime = firstDeadline && today && today <= firstDeadline;
    parts.push(`הדוח נמסר לי ביום ${fmt(served)}${inTime ? ', והבקשה מוגשת בתוך המועד' : ''}.`);
  }
  lines.push(`2. פרטי הדוח: ${parts.join(' ')}`, '');

  lines.push('3. נימוקי הבקשה:', '');
  grounds.forEach((g, i) => {
    lines.push(`   3.${i + 1} ${g.letterTitle}.`);
    lines.push(`   ${g.paragraphText}`, '');
  });

  const attachments = grounds.filter((g) => g.annexLabel).map((g) => `${g.annexLabel} – ${g.annex}`);
  attachments.push('צילום הדוח');
  if (details.authorityKind === 'police') attachments.push('צילום תעודת זהות');
  lines.push(`4. מצורפים: ${attachments.join('. ')}.`, '');
  lines.push('5. לאור האמור, אבקש לבטל את הדוח.', '');
  lines.push(...signature(person));
  return lines.join('\n');
}

/** הודעת בעל הרכב על זהות הנהג (templates/driver-declaration.md) */
export function buildDriverLetter({ details, person, driver, served, today }) {
  const lines = [];
  lines.push(`${or(person.city, '[עיר]')}, ${today ? fmt(today) : '[תאריך]'}`, '');
  lines.push('לכבוד');
  lines.push(details.authorityKind === 'police' ? 'מרכז פניות נהגים ארצי, משטרת ישראל' : `${authorityName(details)} (בערוץ שמודפס על הדוח)`, '');
  lines.push(`הנדון: הודעה על זהות הנהג ובקשה להסבת דוח מספר ${or(details.ticketNumber, '[מספר הדוח]')}`, '');
  lines.push(`1. אני, ${or(person.name, '[שם מלא]')}, ת"ז ${or(person.id, '[מספר]')}, בעל/ת הרכב מספר ${or(details.plate, '[מספר רכב]')}.`, '');
  lines.push(`2. בתאריך ${dateOr(details.offenceDate, '[תאריך העבירה]')}${details.time ? `, בשעה ${details.time}` : ''}, ב${or(details.location, '[מקום]')}, כשבוצעה העבירה המיוחסת בדוח שבנדון, נהג ברכב ${or(driver.name, '[שם מלא של הנהג]')}, ת"ז ${or(driver.id, '[מספר ת"ז מלא]')}, כתובת ${or(driver.address, '[כתובת]')}. לא אני נהגתי ברכב באותה עת.`, '');
  lines.push('3. לפי סעיף 27ב לפקודת התעבורה, אבקש להסב את הדוח על שם הנהג, ולבטל אותו לגביי.', '');
  lines.push(`4. הבקשה מוגשת בתוך 90 יום מיום שהדוח נמסר לי (${served ? fmt(served) : '[תאריך המסירה]'}).`, '');
  lines.push('5. מצורפים: צילום הדוח, צילום תעודת הזהות שלי, אישור חתום של הנהג.', '');
  lines.push('אני מצהיר/ה שכל האמור לעיל אמת.', '');
  lines.push(...signature(person));
  lines.push('', '---', '', 'אישור הנהג', '');
  lines.push(`אני, ${or(driver.name, '[שם מלא]')}, ת"ז ${or(driver.id, '[מספר]')}, מאשר/ת שבתאריך ${dateOr(details.offenceDate, '[..]')}${details.time ? ` בשעה ${details.time}` : ''} נהגתי ברכב מספר ${or(details.plate, '[..]')} במקום המפורט בדוח מספר ${or(details.ticketNumber, '[..]')}.`, '');
  lines.push('חתימה: ____________ תאריך: ________');
  return lines.join('\n');
}
