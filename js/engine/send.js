// לאן שולחים. רק קישורים שמופיעים ב-references/sources.md בסקיל. לא ממציאים כתובות.

export const LINKS = {
  police: {
    label: 'משטרת ישראל: פנייה למרכז פניות נהגים ארצי (gov.il)',
    url: 'https://www.gov.il/he/service/drivers_inquiries_forms',
  },
  telAvivForm: {
    label: 'עיריית תל אביב-יפו: טופס פניות בנושא דוחות חניה',
    url: 'https://www5.tel-aviv.gov.il/TlvFormCollection/Parking/ObjectionReport/',
  },
  telAvivInfo: {
    label: 'עיריית תל אביב-יפו: הסבר על בקשות בנוגע לדוחות',
    url: 'https://www.tel-aviv.gov.il/About/Pages/CancelReports.aspx',
  },
  kolZchut: {
    label: 'כל זכות: ערעור על דוח תנועה',
    url: 'https://www.kolzchut.org.il/he/ערעור_על_דוח_תנועה_לתשלום_קנס',
  },
};

const isTelAviv = (city) => /תל[\s-]?אביב|ת"א|יפו/.test(city || '');

/** אפשרויות שליחה לפי הדוח */
export function sendOptions(details) {
  if (details.authorityKind === 'police') {
    return {
      where: 'השירות "פנייה למרכז פניות נהגים ארצי" של משטרת ישראל ב-gov.il. ממלאים מספר דוח ומטרת פנייה, מדביקים את המכתב ומצרפים צילום של הדוח ושל תעודת הזהות. האישור שמגיע במייל הוא ההוכחה שהפנייה נשלחה.',
      links: [LINKS.police],
      allowEmail: false,
    };
  }
  if (isTelAviv(details.city)) {
    return {
      where: 'טופס הפניות בנושא דוחות חניה של עיריית תל אביב-יפו (גם לדוחות נת"צ של העירייה), או הערוץ שמודפס על הדוח.',
      links: [LINKS.telAvivForm, LINKS.telAvivInfo],
      allowEmail: true,
    };
  }
  return {
    where: 'הערוץ שמודפס על הדוח: אתר העירייה, כתובת מייל או כתובת למשלוח בדואר. אם מודפסת כתובת מייל, אפשר לשלוח ישר מכאן.',
    links: [],
    allowEmail: true,
  };
}

/** קישור mailto עם הנושא והמכתב */
export function mailtoLink(to, subject, body) {
  const enc = encodeURIComponent;
  return `mailto:${enc((to || '').trim())}?subject=${enc(subject)}&body=${enc(body)}`;
}
