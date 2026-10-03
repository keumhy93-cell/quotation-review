// 위젯을 한 파일(ESM)로 묶는다: dist/quotation-review.js + dist/vendor/ (SheetJS, pdf.js)
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['web/widget.js'],
  outfile: 'dist/quotation-review.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  external: ['xlsx'], // Node 전용 경로(import('xlsx')) — 브라우저에서는 실행되지 않는다
  legalComments: 'none',
});
await cp('web/vendor', 'dist/vendor', { recursive: true });
// dist/ 폴더 하나만 웹 서버(사내 서버·정적 호스팅)에 올리면 바로 쓸 수 있도록 단독 실행 페이지도 만든다
await writeFile('dist/index.html', `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>견적서·결과서 검토</title>
<link rel="icon" href="data:,">
<style>
  body { margin: 0; background: #f6f7f9; font-family: -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; }
  @media (prefers-color-scheme: dark) { body { background: #14181f; color: #e7ebf2; } }
  header, #app { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 20px; } h1 { font-size: 21px; margin: 0; } .sub { margin: 2px 0 14px; color: #667085; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>작업환경측정 견적서·결과서 검토</h1>
  <p class="sub">엑셀·PDF 는 사용자의 브라우저 안에서만 읽습니다. 서버로 업로드되지 않습니다.</p>
</header>
<div id="app"></div>
<script type="module">
  import { mountReview } from './quotation-review.js';
  mountReview(document.getElementById('app'));
</script>
</body>
</html>
`);

// ── 파일 하나짜리 review.html: 스크립트·라이브러리·워커를 전부 안에 넣어 더블클릭(file://)으로도 열린다.
// 모듈 import 가 없는 IIFE 번들이라야 file:// 에서 막히지 않는다. Node 전용 경로(top-level await)는 브라우저용 shim 으로 바꾼다.
const browserXlsx = { name: 'browser-xlsx', setup(b) { b.onResolve({ filter: /(^|\/)xlsx\.js$/ }, (a) => (!a.importer.includes('node_modules') ? { path: new URL('../web/xlsx-browser.js', import.meta.url).pathname } : undefined)); } };
const iife = await build({
  entryPoints: ['web/standalone-entry.js'], bundle: true, format: 'iife', target: 'es2019', minify: true, write: false, legalComments: 'none',
  logLevel: 'error', plugins: [browserXlsx],
});
const safe = (t) => t.replace(/<\/(script)/gi, '<\\/$1');
const [xlsx, pdf, worker] = await Promise.all(['xlsx.full.min.js', 'pdf.min.js', 'pdf.worker.min.js'].map((f) => readFile('web/vendor/' + f, 'utf8')));
// 주의: String.replace 의 치환 문자열은 $&, $' 같은 패턴을 해석하므로 반드시 함수로 넘긴다 (압축된 JS 에 $ 가 많다)
const inline = '<script>' + safe(xlsx) + '</script>\n<script>' + safe(pdf) + '</script>\n'
  + '<script>' + safe(worker) + '</script>\n' // 워커 스크립트를 일반 스크립트로 넣으면 pdf.js 가 Worker(blob) 대신 메인 스레드에서 처리 — file:// 에서도 네트워크 요청이 없다
  + '<script>' + safe(iife.outputFiles[0].text) + '</script>\n';
const html = await readFile('dist/index.html', 'utf8');
if (!/<script type="module">[\s\S]*?<\/script>/.test(html)) throw new Error('index.html 에서 module 스크립트를 찾지 못했습니다.');
const page = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => inline);
await writeFile('dist/review.html', page);
console.log('dist/ 생성 완료 (review.html = 파일 하나짜리, index.html + quotation-review.js + vendor/ = 서버 배포용)');
