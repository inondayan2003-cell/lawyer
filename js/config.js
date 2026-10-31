// הגדרות האתר. זה הקובץ היחיד שצריך לערוך כדי להפעיל תשלום.

export const CONFIG = {
  brand: 'ערעור בקליק',

  // תשלום לכל דוח.
  // enabled: false = האתר חינמי.
  // כדי לגבות: פותחים חשבון בחברת סליקה (למשל Cardcom, PayPlus, Tranzila, Grow או Stripe),
  // יוצרים "קישור תשלום" בסכום הרצוי ומדביקים אותו ב-paymentUrl.
  // שימו לב: באתר סטטי אין אימות אמיתי שהתשלום בוצע. לאימות מלא צריך שרת (ראו README).
  payment: {
    enabled: false,
    priceILS: 29,
    paymentUrl: '',
  },

  // קריאת התמונה (OCR) רצה בדפדפן של המשתמש, מקבצים שיושבים באתר עצמו (vendor/tesseract).
  // אין תלות בשום שרת חיצוני.
  ocr: {
    script: 'vendor/tesseract/tesseract.min.js',
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath: 'vendor/tesseract/core',
    langPath: 'vendor/tesseract/lang',
  },
};
