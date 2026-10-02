import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseResultText, reviewResultPdf } from '../src/core/result-pdf.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

const text = fs.readFileSync(new URL('./fixtures/result.txt', import.meta.url), 'utf8');

test('결과서 PDF 텍스트 파싱: 표지·요약·계획·시료', () => {
  const r = parseResultText(text, 'r.pdf');
  assert.equal(r.cover.site, '테스트건설산업(주) - 가나 공동주택 신축공사');
  assert.equal(r.cover.workers, 26);
  assert.equal(r.cover.period, '정기');
  assert.equal(r.summary.length, 3);
  assert.equal(r.plan.length, 5);
  assert.deepEqual(r.plan[0], { dept: '직영', hazard: '기타광물성분진', workers: 8, method: '개인', count: 2 });
  // 장비 부서: 두 인자가 한 시료(측정위치 3) 로 묶여 있다 → 조합 [기타광물성분진 + 산화규소] 1건… 단 시간대가 있는 줄이 새 시료
  const eq = r.samples.filter((s) => s.dept === '장비' && !s.noise);
  assert.equal(eq.length, 2);
  assert.equal(r.samples.filter((s) => s.noise).length, 3);
  assert.equal(r.distribution.length, 2);
});

test('결과서 PDF 검토: 건설업 전회, 인원-건수, 측정 누락, 초과, 임시·단시간 빈도', () => {
  const f = reviewResultPdf(parseResultText(text, 'r.pdf'), DEFAULT_CONFIG);
  const m = f.filter((x) => x.severity !== 'info').map((x) => `${x.category}: ${x.message}`).join('\n');
  assert.match(m, /갑지: 건설업은 전회 측정이 없으므로 "2회 연속 미만"/);
  assert.match(m, /인원↔건수.*\[직영\] 소음: 근로자 8명 → 2건, 측정계획 3건/);
  assert.match(m, /근로자수: 부서별 근로자수 합 20명 ≠ 사업장 근로자 수 26명/);
  assert.match(m, /\[장비\] 기타광물성분진: 측정계획 3건 \/ 결과표 1건/);
  assert.match(m, /초과.*\[장비\] 소음/);
  assert.match(m, /임시·단시간.*\[장비\].*사용빈도/);
});
