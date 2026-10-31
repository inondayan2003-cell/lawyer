// קריאת טקסט מתמונת הדוח, בתוך הדפדפן (Tesseract.js). התמונה לא יוצאת מהמכשיר.

import { CONFIG } from './config.js';
import { parseTicketText } from './engine/ocr-parse.js';

let loading = null;

function loadScript(url) {
  if (window.Tesseract) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('לא הצלחנו לטעון את רכיב קריאת התמונה. בדקו את החיבור לאינטרנט.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** מקטין תמונות גדולות, כדי שהקריאה תהיה מהירה גם בטלפון */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const max = 2000;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.3)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** onProgress(0..1, message) */
export async function readTicket(file, onProgress = () => {}) {
  onProgress(0.02, 'טוענים את רכיב הקריאה...');
  const abs = (p) => new URL(p, document.baseURI).href;
  await loadScript(abs(CONFIG.ocr.script));
  const image = await prepareImage(file).catch(() => file);
  const worker = await window.Tesseract.createWorker(['heb', 'eng'], 1, {
    workerPath: abs(CONFIG.ocr.workerPath),
    corePath: abs(CONFIG.ocr.corePath),
    langPath: abs(CONFIG.ocr.langPath),
    gzip: true,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'קוראים את הדוח...');
      else if (m.status && m.status.includes('load')) onProgress(0.15, 'מכינים את הקריאה בעברית...');
    },
  });
  try {
    const { data } = await worker.recognize(image);
    onProgress(1, 'סיימנו');
    return { text: data.text, fields: parseTicketText(data.text) };
  } finally {
    worker.terminate();
  }
}
