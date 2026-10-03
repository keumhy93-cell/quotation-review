import { mountReview } from './widget.js';

// 파일 하나짜리(review.html)용 진입점: 전역에 노출하고 바로 붙인다.
globalThis.QuotationReview = { mountReview };
const box = document.getElementById('app');
if (box) globalThis.qr = mountReview(box);
