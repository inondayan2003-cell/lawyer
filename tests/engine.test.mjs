// בדיקות למנוע. הרצה: node --test tests/
// התרחישים 1-5 לקוחים מ-tests/scenarios בסקיל, עם אותם תאריכים צפויים.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/engine/analyze.js';
import { computeDeadlines, decideTrack } from '../js/engine/deadlines.js';
import { addMonths, fmt, parseISO, legalDeadline } from '../js/engine/dates.js';
import { parseTicketText } from '../js/engine/ocr-parse.js';

const TODAY = '2026-10-30';

test('תאריכים: חודש קצר וסוף שבוע', () => {
  assert.equal(fmt(addMonths(parseISO('2026-10-31'), 4)), '28.02.2027');
  assert.equal(fmt(addMonths(parseISO('2026-05-20'), 4)), '20.09.2026');
  const sat = parseISO('2026-10-31'); // שבת
  assert.equal(legalDeadline(sat).moved, true);
  assert.equal(fmt(legalDeadline(sat).date), '01.11.2026');
  assert.equal(parseISO('2026-02-30'), null);
});

test('מסלול: חניה תמיד פלילי, מהירות לפני 8.8.2026 פלילי', () => {
  assert.equal(decideTrack({ type: 'parking', offence: parseISO('2026-10-01') }).track, 'criminal');
  assert.equal(decideTrack({ type: 'camera', offence: parseISO('2026-05-20'), fine: 750, speeding: true }).track, 'criminal');
  assert.equal(decideTrack({ type: 'camera', offence: parseISO('2026-10-01'), fine: 1000 }).track, 'admin');
  assert.equal(decideTrack({ type: 'police', offence: parseISO('2026-03-01'), fine: 250 }).track, 'admin');
  assert.equal(decideTrack({ type: 'police', offence: parseISO('2026-03-01'), fine: 1000 }).track, 'criminal');
  assert.equal(decideTrack({ type: 'police', offence: parseISO('2026-03-01') }).track, 'unknown');
  assert.equal(decideTrack({ type: 'natz', offence: parseISO('2026-01-01') }).track, 'criminal');
});

test('תרחיש 1: חניה, סימון דהוי וספרה שגויה', () => {
  const r = analyze({
    today: TODAY,
    details: {
      type: 'parking', authorityKind: 'municipal', city: 'תל אביב-יפו', ticketNumber: '40012345',
      offenceDate: '2026-10-15', time: '09:40', location: 'רחוב הדוגמה 10, תל אביב',
      offenceText: 'העמדת רכב במקום שהסימון בשפת המדרכה אוסר זאת', fine: '250', plate: '12-345-67',
      sentDate: '2026-10-16', servedDate: '2026-10-18',
    },
    answers: {
      p_faded: { value: 'yes', inputs: { color: 'אדום-לבן' } },
      plate: { value: 'one', inputs: { real: '12-345-68' } },
    },
    person: { name: 'ישראל ישראלי', id: '123456782', city: 'תל אביב' },
  });
  assert.equal(r.deadlines.track, 'criminal');
  assert.equal(fmt(r.firstItem.deadline), '17.11.2026');
  assert.deepEqual(r.findings.map((f) => [f.id, f.score]), [['p_faded', 'strong'], ['plate', 'medium']]);
  assert.match(r.letter, /עיריית תל אביב-יפו/);
  assert.match(r.letter, /בקשה לביטול דוח חניה מספר 40012345/);
  assert.match(r.letter, /12-345-68/);
  assert.match(r.warning, /^לפני הכול: אל תשלמו "ליתר ביטחון"\./);
  assert.match(r.warning, /229\(ח\)/);
  assert.doesNotMatch(r.warning, /9\(ב\)/); // בחניה משמיטים את החצי המנהלי
  assert.equal(r.send.links[0].url.includes('tel-aviv'), true);
});

test('תרחיש 2: מצלמה, הגיע 5 חודשים אחרי, תאריך משלוח לא ידוע', () => {
  const r = analyze({
    today: TODAY,
    details: {
      type: 'camera', authorityKind: 'police', ticketNumber: '51234567', offenceDate: '2026-05-20',
      time: '14:05', fine: '750', speeding: true, plate: '98-765-43', servedDate: '2026-10-25',
    },
    answers: {},
  });
  assert.equal(r.deadlines.track, 'criminal');
  assert.equal(fmt(r.firstItem.deadline), '24.11.2026');
  const late = r.findings.find((f) => f.id === 'late');
  assert.ok(late, 'צריך לזהות איחור');
  assert.equal(late.score, 'medium');
  assert.match(late.paragraphText, /225א\(א1\)\(1\)/);
  assert.match(late.paragraphText, /ארבעה חודשים/);
  assert.ok(r.letter);
  assert.doesNotMatch(r.letter + r.findings.map((f) => f.why).join(' '), /הדוח בטל/);
  assert.match(r.send.links[0].url, /drivers_inquiries_forms/);
});

test('איחור עם תאריך משלוח ידוע = טענה חזקה', () => {
  const r = analyze({
    today: TODAY,
    details: { type: 'camera', authorityKind: 'police', offenceDate: '2026-05-20', sentDate: '2026-10-08', servedDate: '2026-10-25', fine: '750', speeding: true },
  });
  assert.equal(r.findings[0].id, 'late');
  assert.equal(r.findings[0].score, 'strong');
});

test('תרחיש 3: מצלמה, מישהו אחר נהג', () => {
  const r = analyze({
    today: TODAY,
    details: {
      type: 'camera', authorityKind: 'police', ticketNumber: '61234567', offenceDate: '2026-10-01',
      time: '22:10', fine: '1000', plate: '11-222-33', sentDate: '2026-10-08', servedDate: '2026-10-12', printedTrack: 'admin',
    },
    otherDriver: { yes: true, name: 'דני ישראלי', id: '987654321', address: 'רחוב הדוגמה 1' },
    person: { name: 'ישראל ישראלי', id: '123456782' },
  });
  assert.equal(r.deadlines.track, 'admin');
  assert.equal(fmt(r.otherItem.deadline), '10.01.2027');
  assert.ok(r.driverLetter);
  assert.match(r.driverLetter, /מרכז פניות נהגים ארצי/);
  assert.match(r.driverLetter, /דני ישראלי/);
  assert.match(r.driverLetter, /27ב/);
  assert.equal(r.letter, null);
});

test('תרחיש 4: נת"צ למונית', () => {
  const r = analyze({
    today: TODAY,
    details: {
      type: 'natz', authorityKind: 'municipal', city: 'תל אביב-יפו', ticketNumber: '70012345', offenceDate: '2026-10-05',
      time: '08:15', fine: '500', plate: '55-666-77', sentDate: '2026-10-10', servedDate: '2026-10-14',
    },
    answers: { n_allowed: { value: 'yes', inputs: { vehicle: 'מונית' } } },
  });
  assert.equal(r.deadlines.track, 'admin');
  assert.equal(fmt(r.firstItem.deadline), '13.11.2026');
  assert.equal(r.findings[0].score, 'strong');
  assert.match(r.letter, /השגה/);
  assert.match(r.letter, /501/);
  assert.match(r.letter, /מונית/);
  assert.doesNotMatch(r.letter, /בקשה להישפט/);
});

test('תרחיש 5: דוח ישן, המועד הראשון עבר', () => {
  const r = analyze({
    today: TODAY,
    details: { type: 'parking', authorityKind: 'municipal', city: 'חיפה', offenceDate: '2026-08-20', servedDate: '2026-08-25', fine: '100' },
    losing: ['one_minute'],
  });
  assert.equal(fmt(r.firstItem.deadline), '24.09.2026');
  assert.equal(r.expired, true);
  assert.equal(fmt(r.secondItem.deadline), '23.11.2026');
  assert.match(r.expiredNote, /בקשה להישפט עד 23\.11\.2026/);
  assert.match(r.expiredNote, /229\(ה\)/);
  assert.match(r.warning, /הורשע/);
  assert.equal(r.filtered.length, 1);
  assert.equal(r.letter, null);
});

test('לא יותר משלוש טענות במכתב, חזקות קודם', () => {
  const r = analyze({
    today: TODAY,
    details: { type: 'parking', city: 'חיפה', offenceDate: '2026-10-20', servedDate: '2026-10-22' },
    answers: {
      p_meter: { value: 'yes' }, emergency: { value: 'yes', inputs: { what: 'כאב בחזה' } },
      p_no_sign: { value: 'yes' }, p_hours: { value: 'yes', inputs: { hours: '08-18' } }, p_breakdown: { value: 'unsure' },
    },
  });
  assert.equal(r.chosen.length, 3);
  assert.deepEqual(r.chosen.map((f) => f.score), ['strong', 'strong', 'medium']);
  assert.equal(r.unsure.length, 1);
  assert.match(r.letter, /נספח א'/);
  assert.match(r.letter, /נספח ג'/);
});

test('חזקת מסירה: בלי תאריך קבלה, 15 יום אחרי המשלוח', () => {
  const d = computeDeadlines({ type: 'parking', offence: '2026-10-01', sent: '2026-10-05', today: TODAY });
  assert.equal(fmt(d.served), '20.10.2026');
  assert.equal(d.presumed, true);
});

test('שגיאה כשתאריך הקבלה לפני העבירה', () => {
  assert.throws(() => computeDeadlines({ type: 'parking', offence: '2026-10-10', served: '2026-10-01' }));
});

test('קריאת טקסט מתמונה', () => {
  const t = `עיריית חיפה הודעת תשלום קנס
  מספר דוח: 40012345
  תאריך העבירה 15/10/2026 בשעה 9:40
  מקום: רחוב הרצל 12 חיפה
  העבירה: חניה במקום אסור
  מספר רכב 12-345-67 סכום 250 ₪
  תאריך הפקה 16.10.2026
  ניתן להגיש בקשה לביטול תוך 30 יום`;
  const p = parseTicketText(t);
  assert.equal(p.type, 'parking');
  assert.equal(p.authorityKind, 'municipal');
  assert.equal(p.city, 'חיפה');
  assert.equal(p.ticketNumber, '40012345');
  assert.equal(p.offenceDate, '2026-10-15');
  assert.equal(p.sentDate, '2026-10-16');
  assert.equal(p.plate, '12-345-67');
  assert.equal(p.fine, '250');
  assert.equal(p.time, '09:40');
  assert.equal(p.printedTrack, 'criminal');
  assert.equal(p.location, 'רחוב הרצל 12 חיפה');
  assert.equal(p.offenceText, 'חניה במקום אסור');
});

test('קריאת טקסט: נת"צ ומשטרה', () => {
  assert.equal(parseTicketText('עיריית תל אביב נתיב תחבורה ציבורית השגה').type, 'natz');
  assert.equal(parseTicketText('משטרת ישראל מצלמת מהירות').type, 'camera');
  assert.equal(parseTicketText('משטרת ישראל').authorityKind, 'police');
});

test('מד חוזק: לא אחוזים, לפי הציונים והמועדים', () => {
  const base = { today: TODAY, details: { type: 'parking', city: 'חיפה', offenceDate: '2026-10-20', servedDate: '2026-10-22' } };
  assert.equal(analyze({ ...base, answers: { p_no_sign: { value: 'yes' }, p_faded: { value: 'yes' } } }).strength.label, 'חזק מאוד');
  assert.equal(analyze({ ...base, answers: { p_no_sign: { value: 'yes' } } }).strength.label, 'חזק');
  assert.equal(analyze({ ...base, answers: { p_meter: { value: 'yes' } } }).strength.label, 'בינוני');
  assert.equal(analyze(base).strength.label, 'חלש');
  const old = analyze({ today: TODAY, details: { type: 'parking', city: 'חיפה', offenceDate: '2026-08-20', servedDate: '2026-08-25' }, answers: { p_no_sign: { value: 'yes' } } });
  assert.equal(old.strength.label, 'בינוני');
  assert.doesNotMatch(JSON.stringify(old.strength), /%|בוטל|בטל/);
});
