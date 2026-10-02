import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { hyundaiWb } from './fixture.mjs';
import { runReview, DEFAULT_CONFIG, mergeConfig } from '../src/core/index.js';
import { validateConfig } from '../src/core/config.js';

const TOL = '톨루엔 / 고체 / GC', ACE = '아세톤 / 고체 / GC';
const good = () => ({
  plan: [['조립', TOL, 'GC(단성분)', 5, 2, 2], ['', ACE, 'GC(단성분)', null, 2, null], ['', '소음', '소음노출량계', null, 2, null]],
  mat: [[1, '측정', TOL, 2, 'GC(단성분)', 100, 200, 300], [2, '측정', ACE, 2, 'GC(단성분)', 100, 200, 300], [3, '공시료', TOL, 1, 'GC(단성분)', 50, 100, 150], [4, '공시료', ACE, 1, 'GC(단성분)', 50, 100, 150]],
  laborMeasure: { 소음노출량계: 2 }, laborAnalysis: { 'GC(단성분)': 6 }, persons: 2,
});
const errs = (o, cfg) => runReview({ company: 'hyundai', estimateWb: hyundaiWb(o), cfg }).estimate.filter((x) => x.severity === 'error').map((x) => x.message);

test('수시수동은 정기수동과 같은 규칙에 노임단가·계수만 다르다', () => {
  assert.deepEqual(errs({ ...good(), period: '수시', mode: '수동' }), []);
  assert.deepEqual(errs({ ...good(), period: '정기', mode: '수동' }), []);
  // 수시 파일에 정기 노임단가가 남아 있으면 잡는다
  const m = errs({ ...good(), period: '수시', mode: '수동', wage: [347410, 311177, 260926, 234568] }).join('\n');
  assert.match(m, /수시 특급기술자 노임단가 347,410 ≠ 기준 260,926/);
});

test('설정에서 수시 노임단가를 바꾸면 검증 기준이 바뀐다', () => {
  const cfg = { companies: { hyundai: { rates: { 수시: { wage: { 특급기술자: 270000 } } } } } };
  const m = errs({ ...good(), period: '수시', mode: '수동' }, cfg).join('\n');
  assert.match(m, /수시 특급기술자 노임단가 260,926 ≠ 기준 270,000/);
});

test('mergeConfig: 일부만 있어도 기본값이 채워지고 원본은 변하지 않는다', () => {
  const merged = mergeConfig({ industry: '제조업' });
  assert.equal(merged.industry, '제조업');
  assert.equal(merged.companies.hyundai.rates.정기.factor, 0.8);
  assert.equal(DEFAULT_CONFIG.industry, '건설업');
  assert.deepEqual(mergeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig(null), DEFAULT_CONFIG);
});

test('validateConfig: 잘못된 값을 메시지로 알려 준다', () => {
  assert.deepEqual(validateConfig(DEFAULT_CONFIG), []);
  const bad = mergeConfig({ companies: { hyundai: { rates: { 수시: { factor: 2, wage: { 특급기술자: -1 } } } } } });
  const e = validateConfig(bad).join('\n');
  assert.match(e, /수시 견적금액 계수/);
  assert.match(e, /수시 특급기술자 노임단가/);
});

test('엉뚱한 파일을 올려도 예외 없이 오류 항목으로 알려 준다', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['아무', '내용']]), 'Sheet1');
  for (const company of ['hyundai', 'gyeryong', 'hanwha']) {
    const r = runReview({ company, estimateWb: wb, submissionWb: wb, results: [{ name: 'x.pdf', text: '내용 없음' }, { name: 'y.xlsx', wb }] });
    assert.ok(r.estimate.length > 0, company);
    assert.ok([...r.estimate, ...r.results].every((f) => f.severity && f.message), company);
  }
});
