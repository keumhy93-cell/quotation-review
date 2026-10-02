import { itemsToLines } from '../src/core/pdf-lines.js';

/** PDF(ArrayBuffer) → 줄바꿈 텍스트. pdf.js 는 web/vendor/pdf.min.js 가 전역 pdfjsLib 로 제공 */
export async function pdfToText(buffer) {
  const lib = globalThis.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = (() => { try { return new URL('./vendor/pdf.worker.min.js', import.meta.url).href; } catch { return 'vendor/pdf.worker.min.js'; } })();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(itemsToLines(tc.items).join('\n'));
  }
  return pages.join('\n');
}
