// 위젯을 한 파일(ESM)로 묶는다: dist/quotation-review.js + dist/vendor/ (SheetJS, pdf.js)
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

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
console.log('dist/quotation-review.js 생성 완료');
