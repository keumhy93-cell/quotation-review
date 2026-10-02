import test from 'node:test';
import assert from 'node:assert/strict';
import { hyundaiWb } from './fixture.mjs';
import { runReview } from '../src/core/index.js';

const TOL = '톨루엔 / 고체 / GC', ACE = '아세톤 / 고체 / GC', XYL = '자일렌 / 고체 / GC';
// 계획서 행: [구분(공정), 유해인자, 측정방법, 근로자수, 측정건수, 측정인원수]
// 재료비 행: [연번, 구분, 유해인자, 측정건수, 분석방법, 측정재료비, 분석재료비, 합계]
const good = () => ({
  plan: [['조립', TOL, 'GC(단성분)', 5, 2, 2], ['', ACE, 'GC(단성분)', null, 2, null], ['', '소음', '소음노출량계', null, 2, null]],
  mat: [[1, '측정', TOL, 2, 'GC(단성분)', 100, 200, 300], [2, '측정', ACE, 2, 'GC(단성분)', 100, 200, 300], [3, '공시료', TOL, 1, 'GC(단성분)', 50, 100, 150], [4, '공시료', ACE, 1, 'GC(단성분)', 50, 100, 150]],
  laborMeasure: { 소음노출량계: 2 }, laborAnalysis: { 'GC(단성분)': 6 }, persons: 2,
});
const run = (o, type) => runReview({ company: 'hyundai', type, estimateWb: hyundaiWb(o) }).estimate;
const errs = (f) => f.filter((x) => x.severity === 'error').map((x) => `${x.category}: ${x.message}`);

test('정상 정기자동 견적은 오류가 없다 (유형 자동판별)', () => {
  const f = run({ ...good(), period: '정기', mode: '자동' });
  assert.deepEqual(errs(f), []);
  assert.equal(f.stats['유형'], '정기자동');
});

test('유형 선택과 파일이 다르면 오류', () => {
  assert.match(errs(run({ ...good(), period: '수시', mode: '수동' }, '정기자동')).join('\n'), /선택한 유형\(정기자동\)과 파일 내용\(수시수동\)/);
});

test('수시 견적에 정기 계수/노임단가가 남아 있으면 오류', () => {
  const m = errs(run({ ...good(), period: '수시', factor: 0.8, wage: [347410, 311177, 260926, 234568] })).join('\n');
  assert.match(m, /계수 ×0\.8 ≠ 기준 ×0\.55/);
  assert.match(m, /특급기술자 노임단가 347,410 ≠ 기준 260,926/);
});

test('공시료 누락·건수 불일치·방법명 공백·합계 불일치·0원', () => {
  const o = good();
  o.mat.pop(); // 아세톤 공시료 삭제
  o.mat[1][3] = 3; // 아세톤 재료비 3건
  o.mat[0][4] = 'GC(단성분 )'; // SUMIF 조건과 공백이 달라 집계에서 빠짐
  o.mat[2][5] = 0; o.mat[2][6] = 0; o.mat[2][7] = 0; // 톨루엔 공시료 0원
  o.matTotalOverride = 1;
  const m = errs(run(o)).join('\n');
  assert.match(m, /아세톤 \/ 고체 \/ GC: 계획서 2건 \/ 재료비내역서\(측정\) 3건/);
  assert.match(m, /아세톤 \/ 고체 \/ GC: 측정은 있으나 공시료가 없습니다/);
  assert.match(m, /분석방법 'GC\(단성분 \)'/);
  assert.match(m, /\[공시료\] 톨루엔 \/ 고체 \/ GC 1건의 재료비가 0원/);
  assert.match(m, /직접경비 재료비 1 ≠ 재료비내역서 합계/);
});

test('갑지 값이 수식이 아니면 연동 오류', () => {
  assert.match(errs(run({ ...good(), hardcodeGap: true })).join('\n'), /갑지 직접인건비이 수식이 아닌 직접 입력 값/);
});

test('물리 인자 건수 불일치 / 단성분인데 다성분 묶음 / 인원-건수', () => {
  const o = good();
  o.laborMeasure = { 소음노출량계: 1 };
  o.plan.push(['', XYL + '\n' + TOL, 'GC(단성분)', null, 2, null]);
  o.mat.push([5, '측정', XYL + '\n' + TOL, 2, 'GC(단성분)', 1, 1, 2]);
  o.plan[0][3] = 12; // 12명 → 3건 필요
  const m = errs(run(o)).join('\n');
  assert.match(m, /소음노출량계: 계획서 2건 \/ 인건비 1건/);
  assert.match(m, /한 시료로 묶였는데 분석방법이 'GC\(단성분\)'/);
  assert.match(m, /근로자 12명 → 3건 필요/);
});

test('사업장 제출용 엑셀 ↔ 견적 대조 (재료비 칸에 직접경비 합계 입력)', async () => {
  const XLSX = (await import('xlsx')).default;
  const est = hyundaiWb({ ...good() });
  const sub = hyundaiWb({ ...good() });
  const ws = XLSX.utils.aoa_to_sheet([[], [], [], [], ['No.', '', '', '', '현장명', '', '구분', '근로자', '', '', '', '', '', '', '직접경비', '', '', '최종수수료'], ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '출장여비', '감가상각비', '재료비'], [1, '', '', '', '[J1]현장', '', '정기', 2, '', '', '', '', '', '', 100, 200, 999999, 12345]]);
  XLSX.utils.book_append_sheet(sub, ws, '실시현황');
  const r = runReview({ company: 'hyundai', estimateWb: est, submissionWb: sub });
  assert.match(errs(r.submission).join('\n'), /재료비 999,999 ≠ 견적서 재료비 합계/);
});

test('수동 갑지: NEGO 를 계수 적용 뒤에 차감하는 산식도 재계산 일치', () => {
  const f = run({ ...good(), period: '정기', mode: '수동', nego: 200, negoAfter: true });
  assert.deepEqual(errs(f), []);
  assert.ok(f.some((x) => x.category === 'NEGO' && /200원/.test(x.message)));
});

test('수동: 직접입력 블록(H~N) ↔ 계획서(A~F) 불일치와 다성분 기준 위반', () => {
  const o = good();
  o.mode = '수동';
  // 직접입력: 톨루엔 건수 3 (계획서는 2), 아세톤 대신 자일렌 입력, 두 인자를 한 시료로 묶었는데 매체가 다름
  o.manual = [
    ['조립', TOL.split(' / ')[0], TOL, 'GC', 5, 3, 2],
    ['', '자일렌', XYL, 'GC', null, 2, null],
    ['', '소음', '소음 / 물리 / 소음노출량계', '소음노출량계', null, 2, null],
  ];
  let m = errs(run(o)).join('\n');
  assert.match(m, /직접입력 3건 \/ 계획서 2건/);
  assert.match(m, /직접입력 인자와 계획서 인자가 다릅니다/);

  const o2 = good(); o2.mode = '수동';
  o2.manual = [
    ['조립', '톨루엔', '톨루엔 / 고체 / GC', 'GC', 5, 2, 2],
    ['', '아세톤', '아세톤 / 확산 / HPLC', 'GC', null, null, null],
    ['', '소음', '소음 / 물리 / 소음노출량계', '소음노출량계', null, 2, null],
  ];
  m = errs(run(o2)).join('\n');
  assert.match(m, /동시포집 기준 위반: 톨루엔 \+ 아세톤/);
});
