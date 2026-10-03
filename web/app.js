import { mountReview } from './widget.js';

// 단독 실행 페이지: 위젯을 그대로 붙인다.
globalThis.qr = mountReview(document.getElementById('app'));
