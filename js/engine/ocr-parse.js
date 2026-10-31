// מוציא פרטים מהטקסט שזוהה בתמונת הדוח. זה ניחוש: המשתמש תמיד מאשר ומתקן.

const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const PLATE_RE = /\b(\d{2,3}-\d{2,3}-\d{2,3})\b/;

function normDate(d, m, y) {
  let year = +y;
  if (year < 100) year += 2000;
  const day = +d, mon = +m;
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || year < 2015 || year > 2100) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** מוצא תאריך שמופיע עד ~40 תווים אחרי אחת ממילות המפתח */
function dateNear(text, keywords) {
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + kw.length + 40);
    DATE_RE.lastIndex = 0;
    const m = DATE_RE.exec(slice);
    if (m) {
      const d = normDate(m[1], m[2], m[3]);
      if (d) return d;
    }
  }
  return null;
}

export function parseTicketText(raw) {
  const text = (raw || '').replace(/[‎‏]/g, '').replace(/[ \t]+/g, ' ');
  const out = {};

  // סוג הדוח
  if (/נת"?צ|נתיב תחבורה ציבורית|נתיב לתחבורה ציבורית/.test(text)) out.type = 'natz';
  else if (/מצלמ|צילום|אכיפה אלקטרונית|מהירות/.test(text) && /משטר/.test(text)) out.type = 'camera';
  else if (/משטרת ישראל|משטרה/.test(text)) out.type = 'police';
  else if (/חני|חוק עזר|מדחן|פקח|עיריי|מועצה/.test(text)) out.type = 'parking';

  if (/משטרת ישראל|משטרה/.test(text)) out.authorityKind = 'police';
  else if (/עיריי|מועצה/.test(text)) out.authorityKind = 'municipal';

  const city = /עיריית[ ]+([֐-׿"'-]+(?:[ ][֐-׿"'-]+)?)/.exec(text);
  if (city) {
    const STOP = /^(מחלקת|אגף|דוח|דו"ח|הודעת|הודעה|הודעות|חניה|חנייה|פיקוח|תשלום|קנס|מס|לכבוד)/;
    const words = city[1].split(' ');
    out.city = (words[1] && STOP.test(words[1]) ? words[0] : words.join(' ')).trim();
  }

  // מה כתוב על הדוח לגבי ערעור
  if (/השגה/.test(text)) out.printedTrack = 'admin';
  else if (/בקשה לביטול|בקשה להישפט/.test(text)) out.printedTrack = 'criminal';

  // סכום
  const amount = /(\d{2,4}(?:,\d{3})?)\s*(?:₪|ש"ח|שח|ש''ח)/.exec(text) || /(?:₪|ש"ח|סכום(?: הקנס)?:?)\s*(\d{2,4}(?:,\d{3})?)/.exec(text);
  if (amount) out.fine = String(Number(amount[1].replace(',', '')));

  // לוחית רישוי
  const plate = PLATE_RE.exec(text) || /(?:רכב|רישוי|רישוי:)\D{0,12}(\d{7,8})\b/.exec(text);
  if (plate) out.plate = plate[1];

  // מספר דוח
  const ticket = /(?:מספר (?:ה)?דוח|דוח מס(?:פר|'|׳)?|מס(?:פר|'|׳) דוח|הודעה מס(?:פר|'|׳)?)\D{0,6}(\d{6,14})/.exec(text);
  if (ticket) out.ticketNumber = ticket[1];
  else {
    const longest = (text.match(/\b\d{8,14}\b/g) || []).sort((a, b) => b.length - a.length)[0];
    if (longest && longest !== (out.plate || '').replace(/-/g, '')) out.ticketNumber = longest;
  }

  // תאריכים
  out.offenceDate = dateNear(text, ['תאריך העבירה', 'תאריך עבירה', 'תאריך ביצוע', 'מועד העבירה', 'ביום']);
  out.sentDate = dateNear(text, ['תאריך משלוח', 'תאריך המשלוח', 'נשלח', 'תאריך הפקה', 'תאריך ההפקה', 'הופק']);
  const all = [];
  DATE_RE.lastIndex = 0;
  let m;
  while ((m = DATE_RE.exec(text))) {
    const d = normDate(m[1], m[2], m[3]);
    if (d) all.push(d);
  }
  all.sort();
  if (!out.offenceDate && all.length) out.offenceDate = all[0];
  if (!out.sentDate && all.length > 1 && all[all.length - 1] !== out.offenceDate) out.sentDate = all[all.length - 1];

  const place = /(?:מקום העבירה|מקום|כתובת העבירה)\s*:?\s*([^\n]{3,60})/.exec(text);
  if (place) out.location = place[1].trim();

  const offence = /(?<!(?:תאריך|מועד|מקום|שעת) )(?:תיאור העבירה|מהות העבירה|העבירה)\s*:\s*([^\n]{3,80})/.exec(text);
  if (offence && !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(offence[1])) out.offenceText = offence[1].trim();

  const time = TIME_RE.exec(text);
  if (time) out.time = `${time[1].padStart(2, '0')}:${time[2]}`;

  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return out;
}
