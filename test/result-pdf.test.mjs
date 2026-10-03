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
  assert.deepEqual(r.plan[0], { dept: '직영', hazard: '기타광물성분진', workers: 8, method: '개인', count: 2, cat: '분진', physical: false });
  assert.equal(r.plan[1].physical, true); // 소음 = 물리적인자
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

const withUsage = (rows) => text.replace('                             해당 사항 없음', rows);
const usageErrs = (rows) => reviewResultPdf(parseResultText(withUsage(rows), 'u.pdf'), DEFAULT_CONFIG).filter((x) => /사용실태|임시|측정 누락/.test(x.category) && /\[직영\].*(산화철|망간|임시)/.test(x.message));

test('사용실태 비고 ↔ 측정계획: 누락은 사유(분포실태 또는 임시·단시간+주기)가 있어야 한다', () => {
  // 직영 부서(측정: 기타광물성분진, 소음)에 산화철·망간 사용이 적혀 있으나 측정계획에 없음
  const bare = '직영           용접봉                  사용   용접용        2 kg   산화철, 망간 함유';
  let f = usageErrs(bare);
  assert.ok(f.some((x) => x.severity === 'error' && x.category === '측정 누락' && /산화철분진과흄/.test(x.message)), '사유 없으면 누락 오류');

  // 임시·단시간 허용소비량 표시는 있으나 주기가 없음
  f = usageErrs('직영           용접봉                  사용   용접용        2 kg   산화철, 망간 함유 (임시·단시간 허용소비량 이하)');
  assert.ok(f.some((x) => x.severity === 'error' && x.category === '임시·단시간'), '주기 없으면 오류');

  // 주기까지 기재되면 통과(참고)
  f = usageErrs('직영           용접봉                  사용   용접용        2 kg   산화철, 망간 함유 (임시·단시간 허용소비량 이하, 월 2회 1시간)');
  assert.equal(f.filter((x) => x.severity === 'error').length, 0);
  assert.ok(f.some((x) => x.severity === 'info' && /사용 주기가 기재/.test(x.message)));
});
