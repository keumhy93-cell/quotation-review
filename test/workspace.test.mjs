import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { MemoryStore } from '../src/store/index.js';
import { Workspace, summarizeProject } from '../src/core/workspace.js';
import { buildBundle } from '../src/core/bundle.js';
import { hyundaiWb, unitPriceWb, statusWb, toBytes } from './fixture.mjs';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const resultText = fs.readFileSync(new URL('./fixtures/result.txt', import.meta.url), 'utf8');
const mk = (user = '김검토') => new Workspace({ store: new MemoryStore(), user, pdfToText: async (buf) => dec(new Uint8Array(buf)) });
const file = (name, data) => ({ name, data: typeof data === 'string' ? enc(data) : data });
const prep = (ws, list) => Promise.all(list.map((f) => ws.prepareFile(f)));
const TOL = '톨루엔 / 고체 / GC', ACE = '아세톤 / 고체 / GC';
const hyGood = (site) => hyundaiWb({
  site, plan: [['조립', TOL, 'GC(단성분)', 5, 2, 2], ['', ACE, 'GC(단성분)', null, 2, null], ['', '소음', '소음노출량계', null, 2, null]],
  mat: [[1, '측정', TOL, 2, 'GC(단성분)', 100, 200, 300], [2, '측정', ACE, 2, 'GC(단성분)', 100, 200, 300], [3, '공시료', TOL, 1, 'GC(단성분)', 50, 100, 150], [4, '공시료', ACE, 1, 'GC(단성분)', 50, 100, 150]],
  laborMeasure: { 소음노출량계: 2 }, laborAnalysis: { 'GC(단성분)': 6 }, persons: 2,
});
const SITE_A = '현대건설 (주)-가나 공동주택 신축공사';

test('파일 자동 분류: 견적 엑셀·결과서 PDF·실시현황', async () => {
  const ws = mk();
  const [e, r, s] = await prep(ws, [file('견적.xlsx', toBytes(hyGood(SITE_A))), file('결과서.pdf', resultText), file('실시현황.xlsx', toBytes(statusWb('hanwha', [{ name: 'X 현장' }])))]);
  assert.equal(e.role, 'hyundai-estimate'); assert.match(e.identity, /^h\|/);
  assert.equal(r.role, 'result-pdf'); assert.match(r.site, /가나 공동주택/);
  assert.equal(s.role, 'status');
});

test('분기 검토: 견적만 올리면 결과서 누락 알림, 결과서를 수정본으로 올리면 해소·이력 기록', async () => {
  const ws = mk();
  const p = await ws.openProject('hyundai', '2026-2분기');
  const up = await ws.submit(p.id, { org: '인천센터', files: await prep(ws, [file('견적.xlsx', toBytes(hyGood(SITE_A)))]) });
  const sum1 = summarizeProject(up.project)[0];
  assert.ok(sum1.missing.some((m) => m.kind === '결과서 없음' && /가나/.test(m.site)), '결과서 누락 알림');
  assert.equal(sum1.openMissing, sum1.missing.length);

  // 누락 알림에 대한 응답 기록
  const key = sum1.missing[0].key;
  const after = await ws.decide(p.id, up.submission.id, { key, choice: 'hold', reason: '센터에 재요청' });
  assert.equal(summarizeProject(after)[0].openMissing, sum1.missing.length - 1);
  await assert.rejects(() => ws.decide(p.id, up.submission.id, { key, choice: 'x' }));

  // 수정본: 결과서 추가 → 결과서 누락 해소 (같은 현장)
  const rev = await ws.revise(p.id, up.submission.id, { files: await prep(ws, [file('결과서.pdf', resultText.replace('테스트건설산업(주) - 가나 공동주택 신축공사', SITE_A))]), note: '결과서 추가' });
  assert.equal(rev.rev, 2);
  assert.ok(!rev.review.missing.some((m) => m.kind === '결과서 없음'), '결과서 누락 해소');
  assert.ok(rev.diff.counts.resolved >= 0);
  const types = rev.project.events.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t !== 'create'), ['submit', 'decision', 'revise']);
  assert.equal(rev.submission.revisions.length, 2);
});

test('수정본 업로드: 같은 현장 결과서는 교체, 다른 현장은 추가, 제거도 가능', async () => {
  const ws = mk();
  const p = await ws.openProject('hyundai', '2026-2분기');
  const textA = resultText.replace('테스트건설산업(주) - 가나 공동주택 신축공사', SITE_A);
  const up = await ws.submit(p.id, { org: '강원센터', files: await prep(ws, [file('견적.xlsx', toBytes(hyGood(SITE_A))), file('결과서_v1.pdf', textA)]) });
  const fixed = textA.replace('[√] 2회 연속 미만', '[ ] 2회 연속 미만'); // 건설업 전회 체크 오류 수정
  const r2 = await ws.revise(p.id, up.submission.id, { files: await prep(ws, [file('결과서_v2.pdf', fixed)]) });
  const names = r2.submission.revisions[1].files.map((f) => f.name).sort();
  assert.deepEqual(names, ['견적.xlsx', '결과서_v2.pdf']);
  assert.deepEqual(r2.submission.revisions[1].replaced, [{ from: '결과서_v1.pdf', to: '결과서_v2.pdf' }]);
  assert.ok(r2.diff.resolved.some((f) => /2회 연속 미만/.test(f.message)), '수정으로 해결된 오류 목록');
  // 제거
  const r3 = await ws.revise(p.id, up.submission.id, { remove: ['결과서_v2.pdf'] });
  assert.equal(r3.submission.revisions[2].files.length, 1);
});

test('확정: 오류가 있으면 막고, 사유가 있으면 예외 확정, 수정본을 올리면 다시 열린다', async () => {
  const ws = mk();
  const p = await ws.openProject('hyundai', '2026-2분기');
  const textA = resultText.replace('테스트건설산업(주) - 가나 공동주택 신축공사', SITE_A);
  const up = await ws.submit(p.id, { org: '강원센터', files: await prep(ws, [file('견적.xlsx', toBytes(hyGood(SITE_A))), file('결과서.pdf', textA)]) });
  const blocked = await ws.finalize(p.id, up.submission.id);
  assert.equal(blocked.ok, false); assert.match(blocked.blockers.join(' '), /오류/);
  assert.equal((await ws.finalize(p.id, up.submission.id, { force: true, reason: '' })).ok, false, '사유 없이 force 불가');
  const ok = await ws.finalize(p.id, up.submission.id, { force: true, reason: '센터 확인 완료' });
  assert.equal(ok.ok, true); assert.equal(ok.forced, true);
  assert.equal(ok.project.submissions[0].status, 'finalized');
  const rv = await ws.revise(p.id, up.submission.id, { files: await prep(ws, [file('결과서2.pdf', textA)]) });
  assert.equal(rv.submission.status, 'open');
});

test('실시현황 취합: 업로드 순서대로 연번, 순서 변경 시 재부여, 중복 알림', async () => {
  const ws = mk();
  const p = await ws.openProject('hanwha', '2026-2분기');
  const sA = statusWb('hanwha', [{ name: 'A현장', fee: 100 }, { name: 'B현장', fee: 200, hazards: ['소음', '분진', '금속'] }]);
  const sB = statusWb('hanwha', [{ name: 'C현장', fee: 300 }, { name: 'A현장', fee: 100, date: 46114 }]); // A 중복 (같은 현장·구분·본측정일)
  await ws.submit(p.id, { org: '인천센터', files: await prep(ws, [file('인천.xlsx', toBytes(sA))]), mode: 'adhoc' });
  const second = await ws.submit(p.id, { org: '강원센터', files: await prep(ws, [file('강원.xlsx', toBytes(sB))]), mode: 'adhoc' });
  let proj = await ws.store.getProject(p.id);
  let { merged } = ws.buildStatus(proj);
  assert.deepEqual(merged.sites.map((s) => `${s.no}:${s.name}`), ['1:A현장', '2:B현장', '3:C현장', '4:A현장']);
  assert.equal(merged.duplicates.length, 1);
  assert.deepEqual(ws.buildStatus(proj, { skipDuplicates: true }).merged.sites.map((s) => s.no), [1, 2, 3]);
  // 순서 변경
  proj = await ws.moveStatusOrder(p.id, second.submission.id, -1);
  merged = ws.buildStatus(proj).merged;
  assert.deepEqual(merged.sites.map((s) => `${s.no}:${s.name}`), ['1:C현장', '2:A현장', '3:A현장', '4:B현장']);
  // 엑셀로 내보내 다시 읽으면 같은 순서·연번
  const { bytes } = await ws.exportStatusXlsx(proj);
  const back = XLSX.read(new Uint8Array(bytes), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets['실시현황'], { header: 1, defval: null });
  const names = rows.filter((r) => typeof r[0] === 'number').map((r) => `${r[0]}:${r[4]}`);
  assert.deepEqual(names, ['1:C현장', '2:A현장', '3:A현장', '4:B현장']);
});

test('최종 ZIP: 건설사 폴더에 취합 실시현황·사용실태·결과서(연번_현장명)·견적서·검토요약', async () => {
  const ws = mk();
  const p = await ws.openProject('gyeryong', '2026-2분기');
  const name = '계룡건설산업㈜-가나 아파트 신축공사';
  const wb = unitPriceWb({ blocks: [{ no: 1, name, period: '정기', workers: 8, rows: [['직영', '기타광물성분진', '분진', '중량분석법(분진)', 8, 2, 37120], ['', '소음', '소음', '소음노출량계', 8, 2, 21900]] }] });
  const result = resultText.replace('테스트건설산업(주) - 가나 공동주택 신축공사', '계룡건설산업(주) - 가나 아파트 신축공사');
  await ws.submit(p.id, { org: '인천센터', files: await prep(ws, [file('산출근거.xlsx', toBytes(wb)), file('결과서.pdf', result)]) });
  const proj = await ws.store.getProject(p.id);
  const { zip, files, notes } = await buildBundle(ws, [[proj]]);
  const z = await JSZip.loadAsync(zip);
  const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
  assert.ok(names.includes('2026-2분기/계룡건설/실시현황_계룡건설_2026-2분기.xlsx'), names.join('\n'));
  assert.ok(names.includes('2026-2분기/계룡건설/사용실태_계룡건설_2026-2분기.xlsx'));
  assert.ok(names.some((n) => /계룡건설\/결과서\/001_계룡건설산업\(주\) - 가나 아파트 신축공사\.pdf$/.test(n)), names.join('\n'));
  assert.ok(names.some((n) => /계룡건설\/견적서\/인천센터\/산출근거\.xlsx$/.test(n)));
  assert.ok(names.includes('2026-2분기/계룡건설/검토요약_계룡건설_2026-2분기.xlsx'));
  assert.equal(dec(await z.file('2026-2분기/계룡건설/결과서/001_계룡건설산업(주) - 가나 아파트 신축공사.pdf').async('uint8array')), result, '결과서 원본이 그대로 들어간다');
  const sumWb = XLSX.read(await z.file('2026-2분기/계룡건설/검토요약_계룡건설_2026-2분기.xlsx').async('uint8array'), { type: 'array' });
  assert.deepEqual(sumWb.SheetNames, ['기관별 요약', '상세(오류·누락)', '이력', '누락 응답']);
  assert.ok(files.length >= 5);
});
