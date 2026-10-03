import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, HttpStore } from '../src/store/index.js';
import { Workspace, BOOK_ID } from '../src/core/workspace.js';
import { templateWorkbook, parseTemplate, mergeCompany, applyPriceBook, extractHyundai, extractUnitPrice, summarizeYear, yearOf } from '../src/core/pricebook.js';
import { runReview } from '../src/core/index.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config.js';
import { hyundaiWb, unitPriceWb, toBytes } from './fixture.mjs';
import { createApp } from '../server/app.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOL = '톨루엔 / 고체 / GC', ACE = '아세톤 / 고체 / GC';
const base = (over = {}) => ({
  site: '현대건설 (주)-가 공사', plan: [['조립', TOL, 'GC(단성분)', 5, 2, 2], ['', ACE, 'GC(단성분)', null, 2, null], ['', '소음', '소음노출량계', null, 2, null]],
  mat: [[1, '측정', TOL, 2, 'GC(단성분)', 100, 200, 300], [2, '측정', ACE, 2, 'GC(단성분)', 100, 200, 300], [3, '공시료', TOL, 1, 'GC(단성분)', 50, 100, 150], [4, '공시료', ACE, 1, 'GC(단성분)', 50, 100, 150]],
  laborMeasure: { 소음노출량계: 2 }, laborAnalysis: { 'GC(단성분)': 6 }, persons: 2,
  jaejip: { [TOL]: [100, 200, 300, 600, 500, 150], [ACE]: [110, 210, 310, 630, 520, 160], '벤젠 / 고체 / GC': [1, 2, 3, 6, 5, 1] }, ...over,
});
const YEAR = {
  hyundai: { wage: { 정기: { 특급기술자: 347410, 고급기술자: 311177, 중급기술자: 260926, 초급기술자: 234568 }, 수시: { 특급기술자: 260926, 고급기술자: 234568, 중급기술자: 260926, 초급기술자: 234568 } }, factor: { 정기: 0.8, 수시: 0.55 }, travelRate: 0.1, depRate: 0.07777, material: base().jaejip },
  gyeryong: { base: [{ label: '1-49인', range: [1, 49], price: 415500 }], methods: { '중량분석법(분진)': 37120 } },
};
const errs = (r) => r.estimate.filter((f) => f.severity === 'error').map((f) => f.message).join('\n');

test('양식 엑셀: 내려받은 양식을 그대로 올리면 같은 값이 나온다 (왕복)', () => {
  const { data, warnings } = parseTemplate(templateWorkbook(2026, YEAR));
  assert.deepEqual(warnings, []);
  assert.deepEqual(data.hyundai.wage, YEAR.hyundai.wage);
  assert.deepEqual(data.hyundai.factor, YEAR.hyundai.factor);
  assert.deepEqual([data.hyundai.travelRate, data.hyundai.depRate], [0.1, 0.07777]);
  assert.deepEqual(data.hyundai.material, YEAR.hyundai.material);
  assert.deepEqual(data.gyeryong.base, YEAR.gyeryong.base);
  assert.deepEqual(data.gyeryong.methods, YEAR.gyeryong.methods);
});

test('양식 엑셀: 빈 칸은 건드리지 않고, 잘못된 행은 경고와 함께 건너뛴다', () => {
  const XLSX = globalThis.XLSX;
  const wb = templateWorkbook(2027, {}); // 값이 모두 빈 양식
  assert.deepEqual(parseTemplate(wb).data, {});
  assert.match(parseTemplate(wb).warnings.join(' '), /읽을 수 있는 단가가 없습니다/);
  // 노임단가 3개만 채움 → 4개 모두 있어야 저장
  const part = templateWorkbook(2027, { hyundai: { wage: { 정기: { 특급기술자: 1, 고급기술자: 2, 중급기술자: 3, 초급기술자: '' } } } });
  const r = parseTemplate(part);
  assert.equal(r.data.hyundai, undefined);
  assert.match(r.warnings.join(' '), /정기 은\(는\) 특급~초급 4개가 모두 있어야/);
});

test('mergeCompany: 바뀐 값만 변경 내역으로 알려 준다', () => {
  const a = mergeCompany('hyundai', {}, { wage: YEAR.hyundai.wage, factor: YEAR.hyundai.factor }, 'a.xlsm');
  assert.ok(a.changes.some((c) => /노임단가 정기 특급기술자: 신규 347,410/.test(c)));
  const b = mergeCompany('hyundai', a.next, { wage: { 정기: { ...YEAR.hyundai.wage.정기, 특급기술자: 360000 } } }, 'b.xlsm');
  assert.deepEqual(b.changes, ['노임단가 정기 특급기술자: 347,410 → 360,000']);
  assert.equal(b.next.wage.수시.특급기술자, 260926, '올리지 않은 수시 값은 유지');
  assert.deepEqual(mergeCompany('hyundai', b.next, { wage: { 정기: b.next.wage.정기 } }).changes, [], '같은 값이면 변경 없음');
  const u = mergeCompany('gyeryong', YEAR.gyeryong, { base: [{ label: '1-49인', range: [1, 49], price: 420000 }] }, 'x');
  assert.ok(u.changes.some((c) => /1-49인: 415,500 → 420,000/.test(c)));
});

test('applyPriceBook: 연도 단가표가 노임단가·계수·재료비단가·계약단가를 덮어쓰고, 없으면 안내', () => {
  const book = { years: { 2026: YEAR } };
  const hy = applyPriceBook(DEFAULT_CONFIG, { years: { 2026: { hyundai: { ...YEAR.hyundai, wage: { 수시: { 특급기술자: 270000, 고급기술자: 1, 중급기술자: 1, 초급기술자: 1 } } } } } }, 'hyundai', 2026);
  assert.equal(hy.cfg.companies.hyundai.rates.수시.wage.특급기술자, 270000);
  assert.ok(hy.notes.some((n) => /정기 노임단가가 등록되지 않았습니다/.test(n)), '빠진 항목 안내');
  assert.ok(hy.cfg.materialPrices[TOL]);
  assert.equal(DEFAULT_CONFIG.companies.hyundai.rates.수시.wage.특급기술자, 260926, '원본 설정은 변하지 않음');
  const gy = applyPriceBook(DEFAULT_CONFIG, book, 'gyeryong', 2026);
  assert.equal(gy.cfg.companies.gyeryong.contract.methods['중량분석법(분진)'], 37120);
  assert.match(applyPriceBook(DEFAULT_CONFIG, book, 'hanwha', 2026).notes.join(' '), /한화건설 기본관리비·기본단가가 등록되지 않아/);
  assert.match(applyPriceBook(DEFAULT_CONFIG, book, 'hyundai', 2030).notes[0], /2030년 단가표가 등록되지 않아/);
  assert.equal(yearOf('2026-2분기'), 2026); assert.equal(yearOf('상반기', new Date('2031-05-01')), 2031);
  assert.deepEqual(summarizeYear(YEAR).hyundai.wage, ['정기', '수시']);
});

test('현대 검토: 등록된 재료비단가표·요율과 다르면 사용한 인자는 오류, 안 쓴 인자는 요약 주의', () => {
  const cfg = mergeConfig({ materialPrices: base().jaejip });
  assert.equal(errs(runReview({ company: 'hyundai', cfg, estimateWb: hyundaiWb(base()) })), '');
  // 파일의 별4.재집에서 톨루엔(사용) 측정단가와 벤젠(미사용) 단가가 등록값과 다름
  const bad = runReview({ company: 'hyundai', cfg, estimateWb: hyundaiWb(base({ jaejip: { ...base().jaejip, [TOL]: [999, 200, 300, 600, 500, 150], '벤젠 / 고체 / GC': [9, 2, 3, 6, 5, 1] } })) });
  assert.match(errs(bad), /톨루엔 \/ 고체 \/ GC: 견적 파일의 재료비단가가 등록된 단가와 다릅니다 — 측정 999 \(등록 100\)/);
  assert.ok(bad.estimate.some((f) => f.severity === 'warn' && /쓰지 않은 유해인자 1종/.test(f.message)));
  // 출장여비율이 다름
  const rate = runReview({ company: 'hyundai', cfg, estimateWb: hyundaiWb(base({ travelRate: 0.12 })) });
  assert.match(errs(rate), /출장여비 요율 0\.12 ≠ 기준 0\.1/);
});

test('Workspace: 단가 등록(연도별) → 작업 기간의 연도 단가표로 검토, 이력·검증', async () => {
  const ws = new Workspace({ store: new MemoryStore(), user: '관리자', pdfToText: async () => '' });
  await assert.rejects(() => ws.registerPrices({ year: '26', company: 'hyundai', incoming: {} }), /4자리/);
  await assert.rejects(() => ws.registerPrices({ year: '2026', company: 'x', incoming: {} }), /건설사/);
  await assert.rejects(() => ws.registerPrices({ year: '2026', company: 'hyundai', incoming: { factor: { 수시: 3 } } }), /계수/);
  const r = await ws.registerPrices({ year: 2026, company: 'hyundai', incoming: YEAR.hyundai, source: '양식' });
  assert.ok(r.changes.length > 5);
  const again = await ws.registerPrices({ year: 2026, company: 'hyundai', incoming: YEAR.hyundai });
  assert.deepEqual(again.changes, []);
  assert.equal((await ws.getPriceBook()).events.length, 1, '변경 없으면 이력도 안 남김');

  // 수시 노임단가를 정기 값으로 잘못 넣은 견적 → 등록된 수시 기준과 달라 오류
  const proj = await ws.openProject('hyundai', '2026-2분기');
  const wb = hyundaiWb(base({ period: '수시', wage: [347410, 311177, 260926, 234568] }));
  const up = await ws.submit(proj.id, { org: '인천센터', mode: 'adhoc', files: [await ws.prepareFile({ name: 'a.xlsx', data: toBytes(wb) })] });
  assert.ok(up.review.findings.some((f) => /수시 특급기술자 노임단가 347,410 ≠ 기준 260,926/.test(f.message)));
  assert.equal(up.review.year, 2026);
  // 단가표가 없는 연도의 작업은 기본값으로 검토하되 안내
  const p2 = await ws.openProject('hyundai', '2031-1분기');
  const up2 = await ws.submit(p2.id, { org: '인천센터', mode: 'adhoc', files: [await ws.prepareFile({ name: 'b.xlsx', data: toBytes(hyundaiWb(base({ period: '수시' }))) })] });
  assert.ok(up2.review.findings.some((f) => f.category === '단가표' && /2031년 단가표가 등록되지 않아/.test(f.message)));
  // 작업 목록에는 단가표 문서가 섞이지 않는다
  assert.ok((await ws.store.listProjects()).some((p) => p.id === BOOK_ID));
  // 삭제
  await ws.removePrices({ year: '2026', company: 'hyundai' });
  assert.deepEqual((await ws.getPriceBook()).years, {});
});

test('견적 엑셀에서 노임단가·재료비단가·계수·요율 추출 / 단가 시트에서 기본관리비·기본단가 추출', () => {
  const e = extractHyundai(hyundaiWb(base({ period: '수시', wage: [1, 2, 3, 4] })), 'x.xlsm');
  assert.equal(e.period, '수시'); assert.deepEqual(e.wage, { 특급기술자: 1, 고급기술자: 2, 중급기술자: 3, 초급기술자: 4 });
  assert.equal(e.factor, 0.55); assert.equal(e.travelRate, 0.1); assert.equal(e.depRate, 0.07777);
  assert.deepEqual(e.material[TOL], [100, 200, 300, 600, 500, 150]);
  const u = extractUnitPrice(unitPriceWb({ blocks: [{ no: 1, name: 'A㈜-가', workers: 8, rows: [['직영', '소음', '소음', '소음노출량계', 8, 2, 21900]] }] }), 'u.xlsx');
  assert.equal(u.base.length, 2); assert.equal(u.methods['소음노출량계'], 21900);
  assert.throws(() => extractHyundai(unitPriceWb({ blocks: [{ no: 1, name: 'A', workers: 8, rows: [] }] })), /노임단가/);
});

test('공유 서버 저장소에서도 단가 등록·조회가 동작한다 (예약 문서 __pricebook__)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qr-'));
  const server = createApp({ dataDir: join(dir, 'd') });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const ws = new Workspace({ store: new HttpStore(`http://127.0.0.1:${server.address().port}`), user: '가', pdfToText: async () => '' });
    const ws2 = new Workspace({ store: new HttpStore(`http://127.0.0.1:${server.address().port}`), user: '나', pdfToText: async () => '' });
    await Promise.all([ws.registerPrices({ year: 2026, company: 'hyundai', incoming: { factor: { 정기: 0.8 } } }), ws2.registerPrices({ year: 2026, company: 'gyeryong', incoming: YEAR.gyeryong })]);
    const book = await ws.getPriceBook();
    assert.equal(book.years[2026].hyundai.factor.정기, 0.8); assert.equal(book.years[2026].gyeryong.base.length, 1);
    assert.deepEqual(book.events.map((e) => e.by).sort(), ['가', '나']);
  } finally { await new Promise((ok) => server.close(ok)); await rm(dir, { recursive: true, force: true }); }
});
