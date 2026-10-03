import test from 'node:test';
import assert from 'node:assert/strict';
import { wbFrom } from './helpers.mjs';
import XLSX from 'xlsx';
import { hyundaiWb } from './fixture.mjs';
import { runReview, DEFAULT_CONFIG } from '../src/core/index.js';
import { requiredSamples } from '../src/core/util.js';

const cfg = structuredClone(DEFAULT_CONFIG);


test('requiredSamples 규칙', () => {
  assert.deepEqual([1, 10, 11, 15, 16, 100, 150].map(requiredSamples), [2, 2, 3, 3, 4, 20, 20]);
});

test('결과서: 누락/과다, 임시단시간, 인원-건수, 갑지 전회, 초과', () => {
  const resWb = wbFrom({
    갑지: [['사업장명', 'OO현장'], ['전회', '☑ 2회 연속 미만']],
    결과: [['부서', '단위작업', '인원', '유해인자', '사용실태 비고', '분포실태', '임시단시간허용소비량', '측정결과', '노출기준', '비고'],
      ['조립', '용접', 12, '톨루엔', '톨루엔, 아세톤', '', 'V', 120, 100, '가끔 사용'],
      ['조립', '용접', 12, '톨루엔', '', '', '', 10, 100, ''],
      ['도장', '도장', 3, '자일렌', '자일렌', '', '', 1, 100, '']],
  });
  const r = runReview({ company: 'hyundai', cfg, resultWbs: [{ name: 'a.xlsx', wb: resWb }] });
  const m = r.results.map((f) => `${f.category}:${f.message}`).join('\n');
  assert.match(m, /측정 누락.*아세톤/);
  assert.match(m, /임시·단시간.*분포실태/);
  assert.match(m, /임시·단시간.*사용빈도/);
  assert.match(m, /측정건수.*3건 필요, 실제 2건/);
  assert.match(m, /측정건수.*2건 필요, 실제 1건/);
  assert.match(m, /갑지.*2회 연속 미만/);
  assert.match(m, /초과.*톨루엔/);
});

test('결과서 ↔ 견적서 조합·건수 비교', () => {
  const est = hyundaiWb({
    plan: [['화학', '톨루엔 / 고체 / GC\n자일렌 / 고체 / GC', '', 5, 2, 5], ['물리', '소음', '소음노출량계', 5, 2, 5], ['화학', '공시료', '', null, 1, null]],
    mat: [[1, '측정', '톨루엔 / 고체 / GC\n자일렌 / 고체 / GC', 2, 'GC(다성분)', 1, 1, 2]],
  });
  const res = wbFrom({ 결과: [['부서', '단위작업', '인원', '유해인자', '사용실태'], ['A', 'x', 5, '톨루엔, 자일렌', '톨루엔, 자일렌'], ['A', 'x', 5, '톨루엔', '톨루엔']] });
  const r = runReview({ company: 'hyundai', cfg, estimateWb: est, resultWbs: [{ name: 'r.xlsx', wb: res }] });
  const m = r.compare.map((f) => f.message).join('\n');
  assert.match(m, /조합 \[자일렌 \+ 톨루엔\]: 견적서 2건 \/ 결과서 1건/);
  assert.match(m, /조합 \[소음\]: 견적서 2건 \/ 결과서 0건/);
  assert.match(m, /조합 \[톨루엔\]: 견적서 0건 \/ 결과서 1건/);
  // 재료비(톨루엔·자일렌)와 결과서 대상 유해인자(톨루엔·자일렌)는 일치
  assert.match(r.compare.map((f) => f.message).join('\n'), /재료비 세부산출표와 결과서 대상 유해인자가 일치합니다 \(2종\)/);
  // 결과서에만 벤젠이 있으면 재료비 누락
  const res2 = wbFrom({ 결과: [['부서', '단위작업', '인원', '유해인자', '사용실태'], ['A', 'x', 5, '톨루엔, 자일렌', ''], ['A', 'x', 5, '벤젠', '']] });
  const r2 = runReview({ company: 'hyundai', cfg, estimateWb: est, resultWbs: [{ name: 'r2.xlsx', wb: res2 }] });
  assert.match(r2.compare.map((f) => f.message).join('\n'), /결과서 대상 유해인자 '벤젠' 가 견적서 재료비 세부산출표에 없습니다/);
});

test('계룡 단가제: 기본관리비·단가·건수·합계·실시현황 검증', () => {
  const put = (ws, a, v, f) => { ws[a] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) }; if (f) ws[a].f = f; };
  const wb = wbFrom({});
  const t = {}; put(t, 'C7', '1-49인'); put(t, 'D7', 415500); put(t, 'C8', '50-99인'); put(t, 'D8', 660000); put(t, 'C18', '중량분석법(분진)'); put(t, 'D18', 37120); put(t, 'C19', '소음노출량계'); put(t, 'D19', 21900); t['!ref'] = 'B2:D62';
  const s = {}; put(s, 'A5', 'No.'); put(s, 'E5', '현장명'); put(s, 'G5', '구분'); put(s, 'I5', '인자'); put(s, 'L5', '최종수수료(원)');
  put(s, 'A6', 1); put(s, 'E6', 'XX 현장'); put(s, 'G6', '수시'); put(s, 'L6', 999); put(s, 'I6', '소음'); s['!ref'] = 'A1:L7';
  const f = {}; put(f, 'A5', 'No. 1'); put(f, 'A6', '현장명'); put(f, 'B6', '계룡건설산업㈜-XX 현장'); put(f, 'D6', '측정구분'); put(f, 'E6', '2026년 상반기 (정기) 측정');
  put(f, 'A10', '총 근로자수'); put(f, 'B10', 26); put(f, 'C10', '사업장 규모'); put(f, 'D10', '50-99인'); put(f, 'E10', 600000); put(f, 'G10', 1); put(f, 'H10', 600000);
  put(f, 'A13', '공종'); put(f, 'B13', '유해인자'); put(f, 'D13', '구분');
  put(f, 'A14', '직영'); put(f, 'B14', '기타광물성분진'); put(f, 'C14', '분진'); put(f, 'D14', '중량분석법(분진)'); put(f, 'F14', 8); put(f, 'G14', 3); put(f, 'H14', 37000, 'VLOOKUP(1,2,3)'); put(f, 'I14', 111000);
  put(f, 'B15', '소음'); put(f, 'C15', '소음'); put(f, 'D15', '소음노출량계'); put(f, 'F15', 8); put(f, 'G15', 2); put(f, 'H15', 21900, 'VLOOKUP(1,2,3)'); put(f, 'I15', 43800);
  put(f, 'A16', '측정분석 수수료 합계'); put(f, 'H16', 154800); put(f, 'A18', '작업환경측정 수수료 합계'); put(f, 'E18', 754800); put(f, 'A20', '최종 수수료 계'); put(f, 'E20', 754800);
  f['!ref'] = 'A1:J21';
  for (const [n, w] of [['단가', t], ['실시현황', s], ['수수료 산출근거(계룡건설)', f]]) XLSX.utils.book_append_sheet(wb, w, n);
  const r = runReview({ company: 'gyeryong', cfg, estimateWb: wb });
  const m = r.estimate.map((x) => `${x.severity}:${x.message}`).join('\n');
  assert.match(m, /총 근로자 26명 → 규모 '1-49인' 이어야 하는데 '50-99인'/);
  assert.match(m, /기본관리비 단가 600,000 ≠ 단가표 660,000/);
  assert.match(m, /기타광물성분진.*8명 → 2건, 입력 3건/);
  assert.match(m, /중량분석법\(분진\): 단가 37,000 ≠ 단가표 37,120/);
  assert.match(m, /최종수수료 754,800 ≠ 실시현황 999/);
  assert.match(m, /구분 불일치 — 산출근거 '정기' \/ 실시현황 '수시'/);
});
