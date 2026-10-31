// המוח: מקבל את פרטי הדוח ואת התשובות, ומחזיר ממצאים, ציונים, מועדים ומכתב מוכן.

import { fmt, parseISO, todayUTC, toISO } from './dates.js';
import { computeDeadlines, TRACK_LABEL } from './deadlines.js';
import { groundsFor, LOSING_CLAIMS, SCORE_RANK, scoreOf } from './grounds.js';
import { annexName, buildAppealLetter, buildDriverLetter } from './letters.js';
import { sendOptions } from './send.js';

export const MAX_LETTER_GROUNDS = 3;

export const DISCLAIMER_LINE = 'זו המחשה שעוזרת לכם להכין את המסמכים, לא ייעוץ משפטי. בתיק רציני, או כשיש נקודות ברישיון, דברו עם עורך דין.';

export function warningText(track) {
  const head = 'לפני הכול: אל תשלמו "ליתר ביטחון".';
  const criminal = 'בדוח חניה עירוני ובכל דוח במסלול הפלילי (בקשה לביטול, בקשה להישפט), מי שמשלם נחשב כאילו הודה באשמה, הורשע ונשא את עונשו (סעיף 229(ח) לחוק סדר הדין הפלילי). כל הדרכים לערער נסגרות.';
  const admin = 'בדוח במסלול המנהלי (השגה, ערר) התשלום הופך את ההחלטה לסופית (סעיף 9(ב) לחוק הפרות תעבורה מינהליות), ועדיין אפשר להגיש ערר בתוך המועד.';
  const tail = 'קודם בודקים, אחר כך מחליטים.';
  if (track === 'criminal') return `${head} ${criminal} ${tail}`;
  if (track === 'admin') return `${head} ${admin} ${tail}`;
  return `${head} ${criminal} ${admin} ${tail}`;
}

function lateFinding(type, track, flag, offence, sent, served) {
  if (!flag.level) return null;
  const camera = type === 'camera' || type === 'natz';
  let src;
  if (track === 'admin') src = camera ? 'סעיף 6(ב)(1) לחוק הפרות תעבורה מינהליות' : 'סעיף 6(א) לחוק הפרות תעבורה מינהליות';
  else if (track === 'criminal') src = camera ? 'סעיף 225א(א1)(1) לחוק סדר הדין הפלילי' : 'סעיף 225א(א) לחוק סדר הדין הפלילי';
  else src = flag.source;
  const period = camera ? 'ארבעה חודשים' : 'שנה';
  const opening = camera ? 'העבירה המיוחסת תועדה במצלמה. ' : '';
  const sentPart = sent
    ? `וההודעה נשלחה ביום ${fmt(sent)}`
    : `וההודעה הגיעה אליי רק ביום ${fmt(served)}`;
  return {
    id: 'late', auto: true,
    title: 'הדוח נשלח באיחור',
    letterTitle: 'הדוח נשלח לאחר המועד שבחוק',
    score: flag.level,
    why: `${flag.message} (${flag.source})`,
    evidence: 'תאריך המשלוח שמודפס על הדוח, והמעטפה שבה הגיע. שמרו אותם.',
    annex: null,
    paragraphText: `${opening}לפי ${src}, לא תומצא הודעה אם עבר${camera ? 'ו' : 'ה'} ${period} מיום ביצוע העבירה וטרם נשלחה. העבירה בוצעה ביום ${fmt(offence)}, ${sentPart}. אבקש לבטל את הדוח, ולחלופין לקבל את התיעוד של מועד המשלוח.`,
  };
}

/**
 * input = {
 *   details: { type, authorityKind, city, ticketNumber, offenceDate, time, location, offenceText,
 *              fine, plate, sentDate, servedDate, speeding, printedTrack, authorityEmail },
 *   answers: { [groundId]: { value, inputs } },
 *   losing: [claimId],
 *   otherDriver: { yes, name, id, address },
 *   person: { name, id, phone, email, address, city },
 *   today: 'YYYY-MM-DD' (לא חובה)
 * }
 */
export function analyze(input) {
  const details = { ...input.details };
  if (!details.authorityKind) details.authorityKind = details.type === 'police' ? 'police' : (details.type === 'camera' ? 'police' : 'municipal');
  const answers = input.answers || {};
  const person = input.person || {};
  const today = parseISO(input.today) || todayUTC();

  const dl = computeDeadlines({
    type: details.type,
    offence: details.offenceDate,
    served: details.servedDate,
    sent: details.sentDate,
    fine: details.fine,
    speeding: details.speeding,
    printedTrack: details.printedTrack,
    today: toISO(today),
  });

  // במסלול לא ברור: המכתב לפי הסכום (עד 500 ₪ מנהלי), עם אזהרה לבדוק
  const letterTrack = dl.track === 'unknown'
    ? (Number(details.fine) > 0 && Number(details.fine) <= 500 ? 'admin' : 'criminal')
    : dl.track;
  const plan = dl.plans[letterTrack] || Object.values(dl.plans)[0];
  const firstItem = plan.items.find((x) => x.key === 'first');
  const secondItem = plan.items.find((x) => x.key === 'second');
  const otherItem = plan.items.find((x) => x.key === 'otherDriver');
  const payItem = plan.items.find((x) => x.key === 'pay');

  const ctx = { details, answers };
  const findings = [];
  const unsure = [];

  const late = lateFinding(details.type, dl.track, dl.limitation, dl.offence, dl.sent, dl.served);
  if (late) findings.push(late);

  for (const g of groundsFor(details.type)) {
    const ans = answers[g.id];
    if (ans && ans.value === 'unsure') {
      unsure.push({ id: g.id, title: g.title, evidence: g.evidence });
      continue;
    }
    const score = scoreOf(g, ans);
    if (!score) continue;
    findings.push({
      id: g.id, title: g.title, letterTitle: g.letterTitle, score, why: g.why,
      evidence: g.evidence, annex: g.annex, ground: g, inputs: (ans && ans.inputs) || {},
    });
  }

  findings.sort((a, b) => SCORE_RANK[a.score] - SCORE_RANK[b.score]);

  // למכתב: עד 3 טענות חזקות או בינוניות
  const chosen = findings.filter((f) => f.score !== 'weak').slice(0, MAX_LETTER_GROUNDS);
  let annexIndex = 0;
  for (const f of chosen) {
    f.inLetter = true;
    f.annexLabel = f.annex ? annexName(annexIndex++) : null;
    if (!f.paragraphText) f.paragraphText = f.ground.paragraph(ctx, f.inputs, f.annexLabel);
  }

  const filtered = LOSING_CLAIMS.filter((c) => (input.losing || []).includes(c.id));

  const otherDriver = input.otherDriver && input.otherDriver.yes ? input.otherDriver : null;
  const realPlate = answers.plate && answers.plate.inputs ? answers.plate.inputs.real : null;

  const letter = chosen.length
    ? buildAppealLetter({
      details, person, track: letterTrack, served: dl.served,
      firstDeadline: firstItem.deadline, today, grounds: chosen, realPlate,
    })
    : null;

  const driverLetter = otherDriver
    ? buildDriverLetter({ details, person, driver: otherDriver, served: dl.served, today })
    : null;

  const send = sendOptions(details);

  // כרטיס פעולה
  const card = [];
  if (otherDriver) {
    card.push({ k: 'מה מגישים', v: `הודעה על זהות הנהג (הסבת הדוח)${letter ? `, ובנוסף ${plan.firstStep}` : ''}` });
    card.push({ k: 'עד מתי (הסבה)', v: `${fmt(otherItem.deadline)}, 90 יום מהיום שהדוח הגיע` });
  } else if (letter) {
    card.push({ k: 'מה מגישים', v: plan.firstStep });
  }
  if (letter) {
    card.push({ k: `עד מתי (${plan.firstStep})`, v: `${fmt(firstItem.deadline)}, 30 יום מהיום שהדוח הגיע` });
    card.push({ k: 'אם נדחה', v: `${plan.secondStep}: 30 יום מההודעה על ההחלטה (ולא יאוחר מהמועד שבהחלטה). בלי בקשה קודמת: עד ${fmt(secondItem.deadline)}` });
    const att = chosen.filter((f) => f.annex).map((f) => f.annex);
    card.push({ k: 'מה מצרפים', v: ['צילום הדוח', ...(details.authorityKind === 'police' ? ['צילום תעודת זהות'] : []), ...att].join(', ') });
  }
  card.push({ k: 'תשלום', v: `לא לשלם עד שמחליטים. מועד התשלום בלי תוספת: ${fmt(payItem.deadline)}` });

  const missing = [];
  if (!details.ticketNumber) missing.push('מספר הדוח');
  if (!person.name) missing.push('שם מלא');
  if (!person.id) missing.push('תעודת זהות');
  if (!details.location) missing.push('מקום העבירה');

  let expiredNote = null;
  if (firstItem.daysLeft != null && firstItem.daysLeft < 0) {
    const lateSrc = letterTrack === 'admin' ? 'סעיף 8(ב)' : 'סעיף 229(ה)';
    if (secondItem.daysLeft >= 0) {
      expiredNote = `המועד ל${plan.firstStep} (${fmt(firstItem.deadline)}) כבר עבר. עדיין אפשר להגיש ${plan.secondStep} עד ${fmt(secondItem.deadline)}. ${plan.firstStep} באיחור תידון רק אם האיחור נבע מסיבה שלא תלויה בכם, והיא הוגשה מיד כשהמניעה הוסרה (${lateSrc}).`;
    } else {
      const extSrc = letterTrack === 'admin' ? 'סעיף 19(ג)' : 'סעיף 230';
      expiredNote = `גם המועד ל${plan.firstStep} וגם המועד ל${plan.secondStep} (${fmt(secondItem.deadline)}) עברו. יש אפשרות לבקש הארכה רק מטעמים מיוחדים (${extSrc}), ובמצב כזה כדאי לדבר עם עורך דין.`;
    }
  }

  return {
    expiredNote,
    details, deadlines: dl, letterTrack,
    trackLabel: TRACK_LABEL[dl.track],
    warning: warningText(dl.track),
    findings, unsure, filtered, chosen,
    letter, driverLetter,
    letterSubject: letter ? letter.split('\n').find((l) => l.startsWith('הנדון:')).replace('הנדון: ', '') : null,
    driverSubject: driverLetter ? driverLetter.split('\n').find((l) => l.startsWith('הנדון:')).replace('הנדון: ', '') : null,
    send, card, missing,
    expired: firstItem.daysLeft != null && firstItem.daysLeft < 0,
    firstItem, secondItem, otherItem, payItem,
    trackWarning: dl.track === 'unknown' ? `לא הצלחנו לקבוע את המסלול בוודאות, ולכן המכתב נכתב כ${letterTrack === 'admin' ? '"השגה"' : '"בקשה לביטול"'}. בדקו מה מודפס על הדוח ותקנו אם צריך.` : null,
    disclaimer: DISCLAIMER_LINE,
  };
}
