// ממשק האתר: אשף בשלבים. כל ההחלטות המשפטיות נמצאות ב-js/engine.

import { CONFIG } from './config.js';
import { analyze } from './engine/analyze.js';
import { fmt, fmtLong } from './engine/dates.js';
import { TYPE_LABEL } from './engine/deadlines.js';
import { groundsFor, LOSING_CLAIMS, SCORE_LABEL } from './engine/grounds.js';
import { mailtoLink } from './engine/send.js';
import { readTicket } from './ocr.js';

const STORAGE_KEY = 'arur-state-v1';
const STEPS = ['photo', 'details', 'questions', 'person', 'results'];

const blank = () => ({
  step: 'home',
  details: {
    type: '', authorityKind: '', city: '', ticketNumber: '', offenceDate: '', time: '', location: '',
    offenceText: '', fine: '', plate: '', sentDate: '', servedDate: '', speeding: false, printedTrack: 'auto', authorityEmail: '',
  },
  answers: {},
  losing: [],
  otherDriver: { yes: false, name: '', id: '', address: '' },
  person: { name: '', id: '', phone: '', email: '', address: '', city: '' },
  ocrFound: [],
  paid: false,
  edits: {},
});

let S = load();
let ocrState = null; // { progress, message, error }
let photoUrl = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.details) return { ...blank(), ...saved };
  } catch { /* ignore */ }
  return blank();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch { /* ignore */ }
}

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
}
function setPath(path, value) {
  const keys = path.split('.');
  let o = S;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function go(step) {
  S.step = step;
  save();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- רכיבי טופס ----------

function field({ path, label, type = 'text', placeholder = '', help = '', required = false, inputmode = '' }) {
  const v = getPath(path) ?? '';
  const auto = S.ocrFound.includes(path) ? '<span class="chip">זוהה מהתמונה</span>' : '';
  return `<label class="field">
    <span class="label">${esc(label)}${required ? ' <b class="req">*</b>' : ''} ${auto}</span>
    <input type="${type}" data-bind="${path}" value="${esc(v)}" placeholder="${esc(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''}>
    ${help ? `<span class="help">${esc(help)}</span>` : ''}
  </label>`;
}

function select({ path, label, options, help = '', required = false }) {
  const v = getPath(path) ?? '';
  const auto = S.ocrFound.includes(path) ? '<span class="chip">זוהה מהתמונה</span>' : '';
  return `<label class="field">
    <span class="label">${esc(label)}${required ? ' <b class="req">*</b>' : ''} ${auto}</span>
    <select data-bind="${path}">
      ${options.map(([val, text]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(text)}</option>`).join('')}
    </select>
    ${help ? `<span class="help">${esc(help)}</span>` : ''}
  </label>`;
}

function radios(name, options, current, rerender = true) {
  return `<div class="radios" role="radiogroup">${options.map(([val, text]) => `
    <label class="radio ${current === val ? 'on' : ''}">
      <input type="radio" name="${esc(name)}" value="${esc(val)}" data-radio="${esc(name)}" ${rerender ? 'data-rerender' : ''} ${current === val ? 'checked' : ''}>
      <span>${esc(text)}</span>
    </label>`).join('')}</div>`;
}

function nav({ back, next, nextLabel = 'המשך', nextAction = 'next' }) {
  return `<div class="nav">
    ${back ? `<button class="btn ghost" data-go="${back}">→ חזרה</button>` : '<span></span>'}
    ${next ? `<button class="btn primary" data-action="${nextAction}" data-next="${next}">${esc(nextLabel)} ←</button>` : ''}
  </div>`;
}

function setProgress() {
  const p = document.getElementById('progress');
  const bar = document.getElementById('progress-bar');
  const i = STEPS.indexOf(S.step);
  p.hidden = i < 0;
  bar.style.width = `${((i + 1) / STEPS.length) * 100}%`;
}

// ---------- מסכים ----------

function viewHome() {
  const hasDraft = S.details.offenceDate || S.details.ticketNumber;
  return `<section class="hero">
    <h1>קיבלתם דוח? מצלמים, עונים על כמה שאלות, ומקבלים ערעור מוכן.</h1>
    <p class="lead">המערכת בודקת את הדוח מול החוק, נותנת ציון לכל טענה, מחשבת את התאריך האחרון להגשה, וכותבת מכתב מוכן לשליחה.</p>
    <div class="cta">
      <button class="btn primary big" data-action="start">📷 מתחילים</button>
      ${hasDraft ? '<button class="btn ghost" data-go="details">להמשיך מאיפה שעצרתי</button>' : ''}
    </div>
    <ul class="features">
      <li><b>כל סוגי הדוחות</b>חניה עירונית, משטרה, מצלמה ונת"צ</li>
      <li><b>תאריכים מדויקים</b>עד מתי מגישים, ומה קורה אם נדחה</li>
      <li><b>ציון לכל טענה</b>חזקה, בינונית, או כזו שעדיף לוותר עליה</li>
      <li><b>פרטיות מלאה</b>התמונה נקראת במכשיר שלכם ולא נשלחת לשום מקום</li>
    </ul>
    <div class="alert warn"><b>⚠️ לפני הכול: אל תשלמו "ליתר ביטחון".</b> בדוח חניה עירוני ובכל דוח במסלול הפלילי, תשלום נחשב הודאה באשמה, וכל הדרכים לערער נסגרות.</div>
  </section>`;
}

function viewPhoto() {
  const busy = ocrState && !ocrState.error && ocrState.progress < 1;
  return `<section class="card">
    <h2>שלב 1: צילום הדוח</h2>
    <p>צלמו את הדוח ישר, באור טוב, כשכל הטקסט בתוך התמונה. המערכת תנסה לקרוא ממנו את הפרטים, ובשלב הבא תוכלו לבדוק ולתקן.</p>
    <label class="upload ${busy ? 'disabled' : ''}">
      <input type="file" accept="image/*" capture="environment" id="photo-input" ${busy ? 'disabled' : ''}>
      ${photoUrl ? `<img src="${photoUrl}" alt="תמונת הדוח">` : '<span class="upload-icon">📷</span><span>לחצו כאן כדי לצלם או לבחור תמונה</span>'}
    </label>
    ${ocrState ? `<div class="ocr-status">
      ${ocrState.error ? `<div class="alert err">${esc(ocrState.error)} אפשר להמשיך ולהקליד את הפרטים בעצמכם.</div>` : `
        <div class="meter"><div style="width:${Math.round(ocrState.progress * 100)}%"></div></div>
        <p class="muted">${esc(ocrState.message || '')}</p>`}
    </div>` : ''}
    ${nav({ back: 'home', next: 'details', nextLabel: photoUrl && !busy ? 'לבדוק את הפרטים' : 'בלי תמונה, אקליד בעצמי' })}
  </section>`;
}

function viewDetails() {
  const d = S.details;
  const isPoliceType = d.type === 'police' || d.type === 'camera';
  const found = S.ocrFound.length
    ? `<div class="alert info">📋 קראנו מהדוח ${S.ocrFound.length} פרטים. הם מסומנים "זוהה מהתמונה". <b>בדקו כל אחד ותקנו אם צריך</b>, כי קריאה של תמונה יכולה לטעות.</div>`
    : '';
  return `<section class="card">
    <h2>שלב 2: פרטי הדוח</h2>
    ${found}
    <div id="errors"></div>
    ${select({ path: 'details.type', label: 'איזה דוח זה?', required: true, options: [['', 'בחרו...'], ['parking', 'דוח חניה מהעירייה (פקח)'], ['police', 'דוח תנועה משוטר'], ['camera', 'דוח מצלמה (מהירות / רמזור)'], ['natz', 'נת"צ: נסיעה בנתיב תחבורה ציבורית']] })}
    ${d.type === 'natz' ? '<p class="note">דוח נת"צ הוא לא דוח חניה, גם כשהוא מגיע מהעירייה. יש לו מסלול משלו.</p>' : ''}
    ${d.type === 'camera' ? select({ path: 'details.authorityKind', label: 'מי שלח את הדוח?', options: [['police', 'משטרת ישראל'], ['municipal', 'העירייה / הרשות המקומית']] }) : ''}
    ${(d.type === 'parking' || d.type === 'natz' || (d.type === 'camera' && d.authorityKind === 'municipal')) ? field({ path: 'details.city', label: 'איזו עירייה?', placeholder: 'למשל: תל אביב-יפו' }) : ''}
    <div class="grid2">
      ${field({ path: 'details.ticketNumber', label: 'מספר הדוח', inputmode: 'numeric' })}
      ${field({ path: 'details.plate', label: 'מספר הרכב שכתוב בדוח', placeholder: '12-345-67' })}
    </div>
    <div class="grid2">
      ${field({ path: 'details.offenceDate', label: 'תאריך העבירה', type: 'date', required: true })}
      ${field({ path: 'details.time', label: 'שעת העבירה', type: 'time' })}
    </div>
    ${field({ path: 'details.location', label: 'מקום העבירה', placeholder: 'רחוב ומספר, עיר' })}
    ${field({ path: 'details.offenceText', label: 'מה כתוב בדוח שהייתה העבירה?', placeholder: 'למשל: חניה במקום שהסימון אוסר' })}
    <div class="grid2">
      ${field({ path: 'details.fine', label: 'סכום הקנס (₪)', type: 'number', inputmode: 'numeric', help: 'כפי שכתוב בדוח' })}
      ${field({ path: 'details.sentDate', label: 'תאריך משלוח / הפקה שמודפס על הדוח', type: 'date', help: 'אם יש. חשוב לבדיקת איחור.' })}
    </div>
    ${field({ path: 'details.servedDate', label: 'מתי הדוח הגיע אליכם בפועל?', type: 'date', required: true, help: 'לא תאריך העבירה. מהיום הזה סופרים את כל המועדים. אם הדוח היה על השמשה, זה יום העבירה.' })}
    ${isPoliceType ? `<label class="check"><input type="checkbox" data-bind="details.speeding" ${d.speeding ? 'checked' : ''}> זו עבירת מהירות</label>` : ''}
    ${select({ path: 'details.printedTrack', label: 'מה כתוב על הדוח לגבי ערעור?', options: [['auto', 'לא יודע/ת, תחשבו בשבילי'], ['criminal', '"בקשה לביטול" / "בקשה להישפט"'], ['admin', '"השגה" / "ערר"']], help: 'אם כתוב, זו הראיה הכי טובה למסלול.' })}
    ${nav({ back: 'photo', next: 'questions', nextAction: 'validate-details' })}
  </section>`;
}

function groundBlock(g) {
  const ans = S.answers[g.id] || {};
  let options;
  if (g.kind === 'choice') options = g.options.map((o) => [o.value, o.label]);
  else options = [['yes', 'כן'], ['no', 'לא'], ['unsure', 'לא בטוח/ה']];
  const active = g.kind === 'choice' ? (g.options.find((o) => o.value === ans.value) || {}).score : ans.value === 'yes';
  const inputs = active && g.inputs ? g.inputs.map((inp) => {
    const path = `answers.${g.id}.inputs.${inp.id}`;
    if (inp.type === 'select') return select({ path, label: inp.label, options: inp.options.map((o) => [o, o]) });
    return field({ path, label: inp.label + (inp.optional ? ' (לא חובה)' : ''), type: inp.type || 'text' });
  }).join('') : '';
  return `<div class="q">
    <p class="q-text">${esc(g.question)}</p>
    ${radios(`answers.${g.id}.value`, options, ans.value)}
    ${inputs ? `<div class="q-inputs">${inputs}</div>` : ''}
  </div>`;
}

function viewQuestions() {
  const type = S.details.type;
  const gs = groundsFor(type);
  const od = S.otherDriver;
  return `<section class="card">
    <h2>שלב 3: מה קרה?</h2>
    <p>ענו בכנות. כל "כן" הופך לטענה במכתב, ולכן חשוב שתוכלו להוכיח אותה. "לא בטוח/ה" לא נכנס למכתב, אבל נגיד לכם מה לבדוק.</p>
    <h3>מי נהג או החנה את הרכב?</h3>
    ${radios('otherDriver.yes', [['me', 'אני'], ['other', 'מישהו אחר']], od.yes ? 'other' : 'me')}
    ${od.yes ? `<div class="q-inputs">
      <p class="note">אפשר להסב את הדוח לנהג תוך 90 יום. הקנס והנקודות עוברים אליו. צריך את מספר תעודת הזהות <b>המלא</b> שלו.</p>
      ${field({ path: 'otherDriver.name', label: 'שם מלא של הנהג' })}
      <div class="grid2">
        ${field({ path: 'otherDriver.id', label: 'ת"ז של הנהג (מלא)', inputmode: 'numeric' })}
        ${field({ path: 'otherDriver.address', label: 'כתובת הנהג (רצוי)' })}
      </div>
    </div>` : ''}
    <h3>שאלות על הדוח</h3>
    ${gs.map(groundBlock).join('')}
    <h3>האם אחד מאלה הוא מה שקרה? (לא חובה)</h3>
    <p class="muted">אלה טענות שרשויות דוחות כמעט תמיד. אם תסמנו, נסביר למה לא כדאי לכתוב אותן.</p>
    ${LOSING_CLAIMS.map((c) => `<label class="check"><input type="checkbox" data-losing="${c.id}" ${S.losing.includes(c.id) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}
    ${nav({ back: 'details', next: 'person' })}
  </section>`;
}

function viewPerson() {
  return `<section class="card">
    <h2>שלב 4: הפרטים שלכם למכתב</h2>
    <p>הפרטים נכנסים רק למכתב, ונשמרים רק במכשיר שלכם. אפשר גם להשאיר ריק ולהשלים במכתב עצמו.</p>
    ${field({ path: 'person.name', label: 'שם מלא' })}
    <div class="grid2">
      ${field({ path: 'person.id', label: 'תעודת זהות (מלאה)', inputmode: 'numeric' })}
      ${field({ path: 'person.phone', label: 'טלפון', type: 'tel' })}
    </div>
    <div class="grid2">
      ${field({ path: 'person.email', label: 'מייל', type: 'email' })}
      ${field({ path: 'person.city', label: 'עיר מגורים' })}
    </div>
    ${field({ path: 'person.address', label: 'כתובת למשלוח דואר' })}
    ${nav({ back: 'questions', next: 'results', nextLabel: 'לבדוק את הדוח', nextAction: 'finish' })}
  </section>`;
}

function viewPay() {
  const p = CONFIG.payment;
  return `<section class="card center">
    <h2>כמעט שם</h2>
    <p>הבדיקה המלאה, התאריכים והמכתב המוכן: <b>${esc(p.priceILS)} ₪</b> לדוח.</p>
    <a class="btn primary big" href="${esc(p.paymentUrl)}" target="_blank" rel="noopener">לתשלום מאובטח</a>
    <p class="muted">אחרי התשלום חזרו לכאן ולחצו:</p>
    <button class="btn ghost" data-action="paid">שילמתי, הראו לי את התוצאות</button>
    ${nav({ back: 'person' })}
  </section>`;
}

function scoreBadge(score) {
  return `<span class="badge ${score}">${esc(SCORE_LABEL[score] || score)}</span>`;
}

function daysText(item) {
  if (item.daysLeft == null) return '';
  if (item.daysLeft < 0) return '<span class="late">עבר</span>';
  if (item.daysLeft === 0) return '<span class="late">היום!</span>';
  return `נשארו ${item.daysLeft} ימים`;
}

function letterBlock(key, title, text, subject, r) {
  const value = S.edits[key] ?? text;
  const send = r.send;
  const email = S.details.authorityEmail || '';
  return `<div class="letter" data-letter="${key}">
    <h3>${esc(title)}</h3>
    <p class="muted">אפשר לערוך את המכתב כאן. השלימו את מה שבסוגריים מרובעים, וחתמו לפני השליחה.</p>
    <textarea data-edit="${key}" rows="22">${esc(value)}</textarea>
    <div class="actions">
      <button class="btn" data-copy="${key}">📋 העתקה</button>
      <button class="btn" data-print="${key}">🖨️ הדפסה / PDF</button>
      ${S.edits[key] != null ? `<button class="btn ghost" data-reset="${key}">↺ לנוסח המקורי</button>` : ''}
    </div>
    <div class="send-box">
      <h4>📨 שליחה</h4>
      <p>${esc(send.where)}</p>
      ${send.links.map((l, i) => `<button class="btn primary" data-open="${esc(l.url)}" data-copyfirst="${key}">${i === 0 ? 'שלח: העתק את המכתב ופתח את ' : 'פתח: '}${esc(l.label)}</button>`).join('')}
      ${send.allowEmail ? `
        <label class="field"><span class="label">כתובת המייל שמודפסת על הדוח (אם יש)</span>
          <input type="email" data-bind="details.authorityEmail" value="${esc(email)}" placeholder="למשל: dohot@city.muni.il"></label>
        <button class="btn primary" data-mail="${key}" data-subject="${esc(subject)}">✉️ שלח במייל</button>
        <p class="muted">הכפתור פותח את המייל שלכם עם המכתב מוכן. צרפו צילום של הדוח ושל הראיות, ולחצו "שלח". שמרו את המייל ששלחתם כהוכחה.</p>` : ''}
    </div>
  </div>`;
}

function viewResults() {
  let r;
  try {
    r = analyze({ ...S, today: undefined });
  } catch (e) {
    return `<section class="card"><div class="alert err">${esc(e.message)}</div>${nav({ back: 'details' })}</section>`;
  }
  const plans = Object.entries(r.deadlines.plans);
  const lim = r.deadlines.limitation;

  return `<section class="results">
    <div class="alert warn big"><b>⚠️ ${esc(r.warning.split('.')[0])}.</b> ${esc(r.warning.split('.').slice(1).join('.').trim())}</div>

    ${r.expiredNote ? `<div class="alert err">⏰ ${esc(r.expiredNote)}</div>` : ''}
    ${r.trackWarning ? `<div class="alert info">${esc(r.trackWarning)}</div>` : ''}
    ${r.deadlines.printedConflict ? `<div class="alert info">${esc(r.deadlines.printedConflict)}</div>` : ''}

    <div class="card">
      <h2>${esc(r.deadlines.typeLabel)}: ${esc(r.trackLabel)}</h2>
      <p>${esc(r.deadlines.trackReason)}</p>
      ${r.letterTrack === 'admin'
    ? '<p class="muted"><b>מסלול מנהלי</b> = השגה לגורם שהוציא את הדוח, ואם נדחתה, ערר לבית הדין לתעבורה (מקוון).</p>'
    : '<p class="muted"><b>מסלול פלילי</b> = בקשה לביטול לגורם שהוציא את הדוח, ואם נדחתה, בקשה להישפט בבית משפט.</p>'}
    </div>

    <div class="card">
      <h2>🗓️ התאריכים שלכם</h2>
      ${plans.map(([t, plan]) => `
        ${plans.length > 1 ? `<h3>אם זה ${t === 'admin' ? 'מסלול מנהלי' : 'מסלול פלילי'}</h3>` : ''}
        <table class="table">
          <thead><tr><th>מה</th><th>עד מתי</th><th></th></tr></thead>
          <tbody>${plan.items.filter((it) => it.key !== 'otherDriver' || S.otherDriver.yes).map((it) => `
            <tr><td>${esc(it.name)}<div class="muted small">${esc(it.note)}</div></td>
            <td class="nowrap"><b>${esc(fmtLong(it.deadline))}</b>${it.moved ? `<div class="muted small">המועד המקורי ${esc(fmt(it.raw))} יוצא בשבת</div>` : ''}</td>
            <td class="nowrap">${daysText(it)}</td></tr>`).join('')}
          </tbody>
        </table>`).join('')}
      ${r.deadlines.notes.map((n) => `<p class="muted small">ℹ️ ${esc(n)}</p>`).join('')}
    </div>

    <div class="card">
      <h2>⚖️ הטענות שמצאנו</h2>
      ${r.findings.length ? `<table class="table">
        <thead><tr><th>טענה</th><th>ציון</th><th>למה</th><th>הראיה להשיג עכשיו</th></tr></thead>
        <tbody>${r.findings.map((f) => `<tr class="${f.inLetter ? '' : 'dim'}">
          <td><b>${esc(f.title)}</b>${f.inLetter ? '<div class="small ok">✔ נכנסה למכתב</div>' : '<div class="small muted">לא נכנסה למכתב (עד 3 הכי חזקות)</div>'}</td>
          <td>${scoreBadge(f.score)}</td><td data-label="למה">${esc(f.why)}</td><td data-label="הראיה להשיג עכשיו">${esc(f.evidence)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="alert info">לא מצאנו טענה עם בסיס בחוק לפי מה שסיפרתם. אם יש פרט שלא שאלנו עליו, כדאי לבדוק עם עורך דין לפני שמחליטים.</div>'}
      ${lim.level ? '' : `<p class="muted small">✔ בדקנו גם אם הדוח נשלח באיחור: המגבלה (${esc(lim.label)} מהעבירה) מסתיימת ב-${esc(fmt(lim.limitEnd))}, ולפי התאריכים שמסרתם אין איחור.</p>`}
      ${r.unsure.length ? `<h3>🔎 שווה לבדוק</h3><ul>${r.unsure.map((u) => `<li><b>${esc(u.title)}:</b> ${esc(u.evidence)} אם זה נכון, חזרו לשלב 3 וסמנו "כן".</li>`).join('')}</ul>` : ''}
      ${r.filtered.length ? `<h3>✂️ טענות שסיננו</h3><ul>${r.filtered.map((c) => `<li>סיננתי את הטענה ${esc(c.label)}, כי ${esc(c.why)}</li>`).join('')}</ul>` : ''}
    </div>

    <div class="card action">
      <h2>🗂️ כרטיס פעולה</h2>
      <dl>${r.card.map((c) => `<dt>${esc(c.k)}</dt><dd>${esc(c.v)}</dd>`).join('')}
        <dt>לאן</dt><dd>${esc(r.send.where)}</dd></dl>
    </div>

    ${r.missing.length ? `<div class="alert info">חסרים במכתב: ${esc(r.missing.join(', '))}. אפשר להשלים <a href="#" data-go="details">בפרטי הדוח</a> או <a href="#" data-go="person">בפרטים האישיים</a>, או ישירות במכתב.</div>` : ''}

    ${r.driverLetter ? letterBlock('driver', '📝 הודעה על זהות הנהג (הסבת הדוח)', r.driverLetter, r.driverSubject, r) : ''}
    ${r.driverLetter ? `<div class="card"><h3>צ'קליסט להסבה</h3><ul class="checklist">
      <li>מספר הדוח, וצילום של הדוח</li><li>שם מלא ומספר תעודת זהות <b>מלא</b> של הנהג</li><li>כתובת הנהג (רצוי)</li>
      <li>ההודעה, חתומה על ידי בעל הרכב</li><li>אישור חתום של הנהג (בתל אביב חובה)</li><li>צילום תעודת זהות של מי שמגיש</li>
      <li>הגשה עד ${esc(fmt(r.otherItem.deadline))}, ושמירת אישור ההגשה</li></ul></div>` : ''}
    ${r.letter ? letterBlock('appeal', `📝 ${r.letterTrack === 'admin' ? 'ההשגה' : 'הבקשה לביטול'}: מוכנה לשליחה`, r.letter, r.letterSubject, r) : ''}

    <div class="alert info"><b>אחרי השליחה:</b> שמרו את אישור ההגשה. ההגשה לא עוצרת את מועד התשלום, אז כשתגיע ההחלטה, בדקו בה את מועד התשלום החדש. ${r.letterTrack === 'admin' ? 'אם ההשגה נדחתה: ערר לבית הדין לתעבורה תוך 30 יום מההחלטה.' : 'אם הבקשה נדחתה: בקשה להישפט תוך 30 יום מההודעה על הדחייה.'}</div>

    <p class="disclaimer">${esc(r.disclaimer)}</p>
    <div class="nav">
      <button class="btn ghost" data-go="questions">→ לשנות תשובות</button>
      <button class="btn ghost" data-action="reset">דוח חדש</button>
    </div>
  </section>`;
}

const VIEWS = { home: viewHome, photo: viewPhoto, details: viewDetails, questions: viewQuestions, person: viewPerson, pay: viewPay, results: viewResults };

function render() {
  $app.innerHTML = (VIEWS[S.step] || viewHome)();
  setProgress();
}

// ---------- אירועים ----------

function validateDetails() {
  const d = S.details;
  const errs = [];
  if (!d.type) errs.push('בחרו איזה דוח זה.');
  if (!d.offenceDate) errs.push('חסר תאריך העבירה.');
  if (!d.servedDate && !d.sentDate) errs.push('חסר התאריך שבו הדוח הגיע אליכם (או לפחות תאריך המשלוח שעל הדוח).');
  if (d.offenceDate && d.servedDate && d.servedDate < d.offenceDate) errs.push('התאריך שבו הדוח הגיע מוקדם מתאריך העבירה. בדקו את התאריכים.');
  const box = document.getElementById('errors');
  if (errs.length) {
    box.innerHTML = `<div class="alert err">${errs.map(esc).join('<br>')}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  if (!d.authorityKind) d.authorityKind = d.type === 'police' || d.type === 'camera' ? 'police' : 'municipal';
  if (d.type === 'police') d.authorityKind = 'police';
  if (d.type === 'parking' || d.type === 'natz') d.authorityKind = 'municipal';
  return true;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function letterText(key) {
  const ta = document.querySelector(`textarea[data-edit="${key}"]`);
  return ta ? ta.value : '';
}

function printLetter(text) {
  const w = window.open('', '_blank');
  if (!w) { toast('הדפדפן חסם חלון חדש. אפשרו חלונות קופצים ונסו שוב.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>מכתב</title>
    <style>body{font-family:Arial,"David",sans-serif;font-size:14pt;line-height:1.6;margin:2.5cm;white-space:pre-wrap}</style></head>
    <body>${esc(text)}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

async function handlePhoto(file) {
  if (!file) return;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(file);
  ocrState = { progress: 0.01, message: 'מתחילים...' };
  render();
  try {
    const { fields } = await readTicket(file, (progress, message) => {
      ocrState = { progress, message };
      const meter = document.querySelector('.meter > div');
      const msg = document.querySelector('.ocr-status .muted');
      if (meter) meter.style.width = `${Math.round(progress * 100)}%`;
      if (msg) msg.textContent = message;
    });
    S.ocrFound = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v == null || v === '') continue;
      S.details[k] = v;
      S.ocrFound.push(`details.${k}`);
    }
    save();
    ocrState = { progress: 1, message: S.ocrFound.length ? `קראנו ${S.ocrFound.length} פרטים מהדוח.` : 'לא הצלחנו לקרוא פרטים מהתמונה. נקליד אותם בשלב הבא.' };
    if (S.step === 'photo') go('details');
  } catch (e) {
    ocrState = { error: e.message || 'קריאת התמונה נכשלה.' };
    render();
  }
}

$app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    setPath(el.dataset.bind, v);
    S.ocrFound = S.ocrFound.filter((p) => p !== el.dataset.bind);
    save();
  } else if (el.dataset.edit) {
    S.edits[el.dataset.edit] = el.value;
    save();
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'photo-input') { handlePhoto(el.files[0]); return; }
  if (el.dataset.radio) {
    const name = el.dataset.radio;
    if (name === 'otherDriver.yes') S.otherDriver.yes = el.value === 'other';
    else setPath(name, el.value);
    save();
    if (el.hasAttribute('data-rerender')) {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
    return;
  }
  if (el.dataset.losing) {
    const id = el.dataset.losing;
    S.losing = el.checked ? [...new Set([...S.losing, id])] : S.losing.filter((x) => x !== id);
    save();
    return;
  }
  if (el.tagName === 'SELECT' && el.dataset.bind) {
    setPath(el.dataset.bind, el.value);
    save();
    if (el.dataset.bind === 'details.type' || el.dataset.bind === 'details.authorityKind') {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-go],[data-action],[data-copy],[data-print],[data-reset],[data-open],[data-mail]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();

  if (el.dataset.go) { go(el.dataset.go); return; }

  const action = el.dataset.action;
  if (action === 'home') { go('home'); return; }
  if (action === 'start') { go('photo'); return; }
  if (action === 'next') { go(el.dataset.next); return; }
  if (action === 'validate-details') { if (validateDetails()) go('questions'); return; }
  if (action === 'finish') {
    go(CONFIG.payment.enabled && CONFIG.payment.paymentUrl && !S.paid ? 'pay' : 'results');
    return;
  }
  if (action === 'paid') { S.paid = true; go('results'); return; }
  if (action === 'reset') {
    if (!confirm('למחוק את הדוח הזה ולהתחיל דוח חדש?')) return;
    S = blank();
    photoUrl = null;
    ocrState = null;
    go('photo');
    return;
  }

  if (el.dataset.copy) {
    toast(await copyText(letterText(el.dataset.copy)) ? 'המכתב הועתק' : 'לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.');
    return;
  }
  if (el.dataset.print) { printLetter(letterText(el.dataset.print)); return; }
  if (el.dataset.reset) { delete S.edits[el.dataset.reset]; save(); render(); return; }
  if (el.dataset.open) {
    if (el.dataset.copyfirst) await copyText(letterText(el.dataset.copyfirst));
    window.open(el.dataset.open, '_blank', 'noopener');
    toast('המכתב הועתק. הדביקו אותו בטופס שנפתח, וצרפו צילום של הדוח.');
    return;
  }
  if (el.dataset.mail) {
    const to = S.details.authorityEmail;
    if (!to || !/@/.test(to)) { toast('הקלידו קודם את כתובת המייל שמודפסת על הדוח.'); return; }
    const body = letterText(el.dataset.mail);
    await copyText(body);
    window.location.href = mailtoLink(to, el.dataset.subject, body);
  }
});

render();
