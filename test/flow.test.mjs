import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { MemoryStore } from '../src/store/index.js';
import { Workspace } from '../src/core/workspace.js';
import { buildBundle } from '../src/core/bundle.js';
import { splitUsage } from '../src/core/usage.js';
import { parseEstimatePdf, compareLaborToPlan } from '../src/core/estimate-pdf.js';
import { parseHyundai } from '../src/core/hyundai.js';
import { validateConfig } from '../src/core/config.js';
import { extractContract, parseUnitPrice } from '../src/core/unitprice.js';
import { reviewBatch } from '../src/core/batch.js';
import { diffFindings, diffFiles, findingKey } from '../src/core/history.js';
import { runReview } from '../src/core/index.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config.js';
import { hyundaiWb, unitPriceWb, statusWb, toBytes } from './fixture.mjs';

const TOL = '톨루엔 / 고체 / GC', ACE = '아세톤 / 고체 / GC';
const SITE = '현대건설 (주)-다라 공동주택 신축공사';
const estWb = (over = {}) => hyundaiWb({
  site: SITE, plan: [['조립', TOL, 'GC(단성분)', 5, 2, 2], ['', ACE, 'GC(단성분)', null, 2, null], ['', '소음', '소음노출량계', null, 2, null]],
  mat: [[1, '측정', TOL, 2, 'GC(단성분)', 100, 200, 300], [2, '측정', ACE, 2, 'GC(단성분)', 100, 200, 300], [3, '공시료', TOL, 1, 'GC(단성분)', 50, 100, 150], [4, '공시료', ACE, 1, 'GC(단성분)', 50, 100, 150]],
  laborMeasure: { 소음노출량계: 2 }, laborAnalysis: { 'GC(단성분)': 6 }, persons: 2, period: '수시', ...over,
});
/** 견적서 PDF 에서 뽑은 텍스트와 같은 모양의 합성 텍스트 */
const estPdfText = ({ total, labor = 1000000, direct, persons = 2, samples = 8, noise = 2, gc = 6 }) => `[총괄표]
             2026년 작업환경측정 수시 견적서
공급자          (사)대한산업보건협회 강원센터
${SITE.split('-')[0]}-${SITE.split('-')[1]}                       견적담당자
      신축공사                        귀중
▣ 견적사항
    직접인건비                                                     ${labor.toLocaleString()} 원
      직접경비                                                     ${direct.toLocaleString()} 원
  조정금액(NEGO)                                                         0원
   견적금액                 일금 ㅇㅇ원정           ₩           ${total.toLocaleString()}      [부가세 없음]
[붙임1]
                                             인건비 세부산출내역서 [투입인원수]
   측정 대상 인원(인)         ${persons}    일반사업장           1
    전체 시료 수(건)         ${samples}   도서지역 사업장         0
   4.1 소음
        4.1.1 소음노출량계           ${noise}      건                               0.030       0.030    21.000
        4.1.2 주파수분석기           0       건                               0.060       0.060     -
5. 시료 분석
   5.6 GC(단성분)                 ${gc}      건                               0.120       0.120     -
   5.2 AAS(다성분)                0       건                               0.140       0.140     -
[붙임2]
`;

test('splitUsage: 사용실태 행을 칸으로 나눈다 (실패하면 원문만)', () => {
  const r = splitUsage('CR-13 사용 용접용 2 kg 이산화티타늄, 망간 함유');
  assert.deepEqual([r.product, r.kind, r.purpose, r.amount, r.note], ['CR-13', '사용', '용접용', '2 kg', '이산화티타늄, 망간 함유']);
  assert.equal(splitUsage('모양이 다른 텍스트').raw, '모양이 다른 텍스트');
});

test('견적서 PDF: 갑지·인건비 세부건수 파싱', () => {
  const e = parseHyundai(estWb()), total = e.gap.total.v;
  const pdf = parseEstimatePdf(estPdfText({ total, direct: e.gap.direct.v }), 'e.pdf');
  assert.equal(pdf.period, '수시'); assert.equal(pdf.gap.total, total); assert.equal(pdf.labor.persons, 2); assert.equal(pdf.labor.samples, 8);
  assert.deepEqual(pdf.labor.methods.filter((m) => m.count).map((m) => [m.id, m.label, m.count]), [['4.1.1', '소음노출량계', 2], ['5.6', 'GC(단성분)', 6]]);
});

test('견적서 PDF: pdf.js 처럼 라벨 글자 사이에 공백이 들어가도 읽는다', () => {
  const e = parseHyundai(estWb());
  const spaced = estPdfText({ total: e.gap.total.v, direct: e.gap.direct.v }).replace('견적금액', '견 적 금 액').replace('직접인건비', '직 접 인 건 비').replace('측정 대상 인원(인)', '측정 대상 인원 ( 인 )');
  const pdf = parseEstimatePdf(spaced, 'e.pdf');
  assert.equal(pdf.gap.total, e.gap.total.v); assert.equal(pdf.gap.labor, 1000000); assert.equal(pdf.labor.persons, 2);
});

test('인건비 건수·세부건수 ↔ 측정계획: 일치하면 오류 없고, 다르면 항목별로 지적', () => {
  const e = parseHyundai(estWb()), total = e.gap.total.v, direct = e.gap.direct.v;
  assert.deepEqual(compareLaborToPlan(parseEstimatePdf(estPdfText({ total, direct }), 'e.pdf'), e).filter((f) => f.severity === 'error'), []);
  const bad = compareLaborToPlan(parseEstimatePdf(estPdfText({ total, direct, noise: 3, gc: 5, samples: 8, persons: 3 }), 'e.pdf'), e).map((f) => f.message).join('\n');
  assert.match(bad, /4\.1\.1 소음노출량계: 3건 \/ 측정계획서 2건/);
  assert.match(bad, /5\.6 GC\(단성분\): 5건 \/ 재료비내역서 6건/);
  assert.match(bad, /측정 대상 인원 3명 \/ 측정계획서 측정인원수 합 2명/);
});

test('수시 검토(adhoc): 견적 엑셀·견적 PDF 만으로 검토하고 결과서는 요구하지 않는다 / 분기(quarter): 결과서 누락 알림', () => {
  const e = parseHyundai(estWb());
  const files = [{ name: '견적.xlsx', role: 'hyundai-estimate', wb: estWb() }, { name: '견적.pdf', role: 'estimate-pdf', text: estPdfText({ total: e.gap.total.v, direct: e.gap.direct.v }) }];
  const a = reviewBatch({ company: 'hyundai', mode: 'adhoc', files });
  assert.equal(a.missing.length, 0); assert.deepEqual(a.findings.filter((f) => f.severity === 'error'), []);
  const q = reviewBatch({ company: 'hyundai', mode: 'quarter', files });
  assert.ok(q.missing.some((m) => m.kind === '결과서 없음'));
  // 견적 PDF 의 인건비 건수가 계획서와 다르면 수시 검토에서도 잡힌다
  const broken = reviewBatch({ company: 'hyundai', mode: 'adhoc', files: [files[0], { ...files[1], text: estPdfText({ total: e.gap.total.v, direct: e.gap.direct.v, gc: 4 }) }] });
  assert.ok(broken.findings.some((f) => f.category === '인건비↔재료비' && /GC\(단성분\)/.test(f.message)));
});

test('계약 단가표: 파일에서 뽑아 기준으로 저장하면, 단가 시트가 계약과 다를 때 오류', () => {
  const block = { no: 1, name: '계룡건설산업㈜-가 공사', period: '정기', workers: 8, rows: [['직영', '기타광물성분진', '분진', '중량분석법(분진)', 8, 2, 37120], ['', '소음', '소음', '소음노출량계', 8, 2, 21900]] };
  const contract = extractContract(unitPriceWb({ blocks: [block] }));
  assert.equal(contract.base.length, 2); assert.equal(contract.methods['중량분석법(분진)'], 37120);
  const cfg = mergeConfig({ companies: { gyeryong: { contract } } });
  const ok = runReview({ company: 'gyeryong', cfg, estimateWb: unitPriceWb({ blocks: [block] }) });
  assert.deepEqual(ok.estimate.filter((f) => f.severity === 'error'), []);
  assert.ok(!ok.estimate.some((f) => /계약 기준 단가표가 설정되지 않아/.test(f.message)));
  // 계약이 37,000 이라면 파일의 단가표(37,120)와 행 단가가 모두 어긋난다
  const cfg2 = mergeConfig({ companies: { gyeryong: { contract: { ...contract, methods: { ...contract.methods, '중량분석법(분진)': 37000 } } } } });
  const bad = runReview({ company: 'gyeryong', cfg: cfg2, estimateWb: unitPriceWb({ blocks: [block] }) }).estimate.map((f) => f.message).join('\n');
  assert.match(bad, /단가 시트의 중량분석법\(분진\) 37,120원 ≠ 계약 37,000원/);
  assert.match(bad, /중량분석법\(분진\): 단가 37,120 ≠ 단가표 37,000/);
});

test('견적서 PDF: 전체 시료 수가 세부건수 합과 다르면 지적', () => {
  const e = parseHyundai(estWb());
  const bad = compareLaborToPlan(parseEstimatePdf(estPdfText({ total: e.gap.total.v, direct: e.gap.direct.v, samples: 9 }), 'e.pdf'), e).map((f) => f.message).join('\n');
  assert.match(bad, /전체 시료 수 9건 ≠ 방법별 세부건수 합 8건/);
});

test('이력 비교: 해결/남음/신규, 파일 변경', () => {
  const f = (message, severity = 'error') => ({ site: 'A', category: 'c', message, severity });
  const d = diffFindings([f('1'), f('2'), f('3', 'info')], [f('2'), f('4', 'warn'), f('5', 'info')]);
  assert.deepEqual(d.counts, { resolved: 1, remaining: 1, introduced: 1 }); // info 는 비교 대상 아님
  assert.equal(findingKey(f('x')), 'A|c|x');
  const files = diffFiles([{ role: 'r', identity: 'a', hash: '1', name: 'a' }, { role: 'r', identity: 'b', hash: '2', name: 'b' }], [{ role: 'r', identity: 'a', hash: '9', name: 'a2' }, { role: 'r', identity: 'c', hash: '3', name: 'c' }]);
  assert.deepEqual([files.added.length, files.removed.length, files.changed.length], [1, 1, 1]);
});

test('반기 병합: 두 분기 프로젝트의 실시현황·결과서를 하나의 폴더로 (연번은 분기 순서→업로드 순서)', async () => {
  const ws = new Workspace({ store: new MemoryStore(), user: '관리자', pdfToText: async () => '' });
  const mkSub = async (period, org, sites) => {
    const p = await ws.openProject('hanwha', period);
    const f = await ws.prepareFile({ name: `${org}.xlsx`, data: toBytes(statusWb('hanwha', sites)) });
    await ws.submit(p.id, { org, files: [f], mode: 'adhoc' });
    return ws.store.getProject(p.id);
  };
  const q1 = await mkSub('2026-1분기', '인천센터', [{ name: '1분기A' }, { name: '1분기B' }]);
  const q2 = await mkSub('2026-2분기', '강원센터', [{ name: '2분기C' }]);
  const { zip, files } = await buildBundle(ws, [[q1, q2]], { periodLabel: '2026-상반기' });
  const z = await JSZip.loadAsync(zip);
  const statusPath = '2026-상반기/한화건설/실시현황_한화건설_2026-상반기.xlsx';
  assert.ok(files.includes(statusPath), files.join('\n'));
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.read(await z.file(statusPath).async('uint8array'), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['실시현황'], { header: 1, defval: null }).filter((r) => typeof r[0] === 'number');
  assert.deepEqual(rows.map((r) => `${r[0]}:${r[4]}`), ['1:1분기A', '2:1분기B', '3:2분기C']);
});

test('측정계획서에서 ICP(다성분)가 인자별 별도 시료로 입력되면 건수 합이 부풀어 원인과 함께 지적한다', () => {
  const unit = { dept: '용접공', people: 2 };
  const g = (hazards, method, samples, extra = {}) => ({ hazards, method, samples, unit, blank: false, ...extra });
  const plan = {
    groups: [g(['소음'], '소음노출량계', 2), g(['산화철분진과흄'], 'ICP', 2), g(['이산화티타늄'], 'ICP', 2), g(['망간및그무기화합물'], 'ICP', 2), g(['망간및그무기화합물', '산화철분진과흄', '이산화티타늄'], 'ICP', 1, { blank: true, unit: { dept: '공시료' } })],
    material: [{ method: 'ICP', count: 2, blank: false, hazards: ['망간및그무기화합물', '산화철분진과흄', '이산화티타늄'] }, { method: 'ICP', count: 1, blank: true, hazards: ['망간및그무기화합물', '산화철분진과흄', '이산화티타늄'] }],
  };
  const pdf = { file: 'e.pdf', labor: { samples: 5, persons: null, methods: [{ id: '4.1.1', label: '소음노출량계', section: 4, count: 2 }, { id: '5.3', label: 'ICP', section: 5, count: 3 }] } };
  const msg = compareLaborToPlan(pdf, plan).map((f) => f.message).join('\n');
  assert.match(msg, /5\.3 ICP: 3건 \/ 측정계획서 건수 합 7건 — 원인: \[용접공\] 산화철분진과흄, 이산화티타늄, 망간및그무기화합물 3개 인자가 각각 별도 시료\(2\+2\+2건\)/);
  assert.match(msg, /전체 시료 수 5건 ≠ 측정계획서 건수 합 9건 .*공시료 1건 포함/);
  // 병합되어 있으면(첫 행만 건수) 오류 없음
  plan.groups.splice(1, 3, g(['망간및그무기화합물', '산화철분진과흄', '이산화티타늄'], 'ICP', 2));
  assert.deepEqual(compareLaborToPlan(pdf, plan), []);
});

test('묶음 규칙: 수산화나트륨은 수산화칼륨과만, 주석(유기화합물)은 단성분이라 묶이면 안 된다', async () => {
  const { bundleViolations, bundleKey } = await import('../src/core/bundle-rules.js');
  assert.deepEqual(bundleViolations(['수산화나트륨', '수산화칼륨']), []);
  assert.deepEqual(bundleViolations(['망간및그무기화합물', '산화철분진과흄', '이산화티타늄']), []);
  assert.match(bundleViolations(['수산화나트륨', '망간및그무기화합물'])[0], /수산화나트륨 은\(는\) 수산화칼륨 와\(과\)만/);
  assert.match(bundleViolations(['주석(유기화합물)', '망간및그무기화합물'])[0], /주석\(유기화합물\) 은\(는\) 단성분/);
  assert.equal(bundleKey(['주석(유기화합물)']), null);
  assert.equal(bundleKey(['수산화나트륨']), bundleKey(['수산화칼륨']));
  assert.notEqual(bundleKey(['수산화나트륨']), bundleKey(['망간']));
});

test('ICP 병합 누락 판단: 병합 후보는 묶일 수 있는 인자끼리만 (주석 단독·수산화나트륨/칼륨 짝 규칙 반영)', () => {
  const unit = { dept: '용접공', people: 2 };
  const g = (hazards, samples) => ({ hazards, method: 'ICP', samples, unit, blank: false });
  const pdf = (n) => ({ file: 'e.pdf', labor: { samples: n, persons: null, methods: [{ id: '5.3', label: 'ICP', section: 5, count: n }] } });
  // 주석(유기화합물)은 단성분 → 망간과 따로 입력된 것이 정상 (2건 + 2건 = 4건)
  let plan = { groups: [g(['망간및그무기화합물'], 2), g(['주석(유기화합물)'], 2)], material: [] };
  assert.deepEqual(compareLaborToPlan(pdf(4), plan), []);
  // 그런데 견적서 PDF 가 3건이면 차이가 나지만, 주석은 병합 후보가 아니므로 '병합 누락' 원인으로 지목하지 않는다
  assert.doesNotMatch(compareLaborToPlan(pdf(3), plan).map((f) => f.message).join('\n'), /별도 시료/);
  // 수산화나트륨·수산화칼륨은 서로 병합 후보 → 따로 입력되면 원인으로 지목
  plan = { groups: [g(['수산화나트륨'], 2), g(['수산화칼륨'], 2)], material: [] };
  assert.match(compareLaborToPlan(pdf(2), plan).map((f) => f.message).join('\n'), /수산화나트륨, 수산화칼륨 2개 인자가 각각 별도 시료/);
  // 수산화나트륨이 망간과 따로 입력된 것은 병합 후보가 아니다 (둘은 묶일 수 없음)
  plan = { groups: [g(['수산화나트륨'], 2), g(['망간및그무기화합물'], 2)], material: [] };
  assert.doesNotMatch(compareLaborToPlan(pdf(2), plan).map((f) => f.message).join('\n'), /별도 시료/);
});

test('reviewBundling: 계획서·재료비내역서에서 규칙을 어긴 묶음을 위치와 함께 오류로 낸다', async () => {
  const { reviewBundling } = await import('../src/core/hyundai.js');
  const p = {
    groups: [{ hazards: ['수산화나트륨', '수산화칼륨'], unit: { dept: 'A' }, sheet: '계획서', rows: [3], blank: false }, { hazards: ['주석(유기화합물)', '망간및그무기화합물'], unit: { dept: 'B' }, sheet: '계획서', rows: [7], blank: false }],
    material: [{ hazards: ['수산화나트륨', '망간및그무기화합물'], blank: false, sheet: '재료비', row: 5 }],
  };
  const f = reviewBundling(p);
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.severity === 'error' && x.category === '다성분'));
  assert.ok(f.some((x) => /계획서 \[B\] 주석\(유기화합물\) 은\(는\) 단성분/.test(x.message) && x.where === '계획서 7행'));
  assert.ok(f.some((x) => /재료비내역서 수산화나트륨/.test(x.message) && x.where === '재료비 5행'));
});

test('방법별 건수: 주석(유기화합물)이 다른 ICP 인자와 한 시료로 묶이면 계획서 합계가 모자라 원인과 함께 지적한다 / (STEL) 표기·단성분+다성분 공존은 오류가 아니다', async () => {
  const { reviewMethodCounts } = await import('../src/core/hyundai.js');
  const unit = { dept: '배관' };
  const g = (hazards, method, samples, blank = false) => ({ hazards, method, samples, unit, blank, sheet: '계획서', rows: [18] });
  const m = (hazards, method, count, blank = false) => ({ hazards, method, count, blank });
  const p = {
    groups: [g(['주석(유기화합물)', '산화철분진과흄', '이산화티타늄'], 'ICP', 3), g(['수산화나트륨'], 'ICP', 2), g(['수산화나트륨'], 'ICP', 1, true)],
    material: [m(['주석(유기화합물)'], 'ICP', 3), m(['산화철분진과흄', '이산화티타늄'], 'ICP', 3), m(['수산화나트륨(STEL)'], 'ICP', 2), m(['수산화나트륨(STEL)'], 'ICP', 1, true)],
  };
  const f = reviewMethodCounts(p);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /ICP 건수 합: 계획서 6건\(측정 5 \+ 공시료 1\) \/ 재료비내역서 9건\(측정 8 \+ 공시료 1\) — 원인: \[배관\] 주석\(유기화합물\) \+ 산화철분진과흄 \+ 이산화티타늄 이\(가\) 한 시료\(3건\)로 묶여 있음/);
  // 주석을 분리해서 입력했으면 일치
  p.groups = [g(['주석(유기화합물)'], 'ICP', 3), g(['산화철분진과흄', '이산화티타늄'], 'ICP', 3), g(['수산화나트륨'], 'ICP', 2), g(['수산화나트륨'], 'ICP', 1, true)];
  assert.deepEqual(reviewMethodCounts(p), []);
});

test('계룡·한화(단가제)에도 묶음 규칙 적용: 주석(유기화합물) 묶음 오류, ICP 인자별 분리 입력은 병합 확인 경고', () => {
  const rows = [
    ['용접', '금속류\n(주석(유기화합물),망간)', '금속', 'ICP', 8, 2, 100000],
    ['용접', '산화철분진과흄', '금속', 'ICP', 8, 2, 100000],
    ['용접', '이산화티타늄', '금속', 'ICP', 8, 2, 100000],
    ['도장', '수산화나트륨', '금속', 'ICP', 8, 2, 100000],
    ['도장', '수산화칼륨', '금속', 'ICP', 8, 2, 100000],
  ];
  const block = { no: 1, name: '계룡건설산업㈜-가 공사', period: '정기', workers: 8, rows };
  const f = runReview({ company: 'gyeryong', cfg: mergeConfig({}), estimateWb: unitPriceWb({ blocks: [block] }) }).estimate.filter((x) => x.category === '다성분');
  assert.ok(f.some((x) => x.severity === 'error' && /주석\(유기화합물\) 은\(는\) 단성분/.test(x.message)));
  // 용접: 산화철·이산화티타늄은 서로 병합 후보, 도장: 수산화나트륨·칼륨도 서로 병합 후보 (주석 포함 행은 후보가 아님)
  const warns = f.filter((x) => x.severity === 'warn').map((x) => x.message);
  assert.ok(warns.some((m) => /\[용접\] ICP 인 산화철분진과흄, 이산화티타늄 가 각각 별도 시료/.test(m)));
  assert.ok(warns.some((m) => /\[도장\] ICP 인 수산화나트륨, 수산화칼륨 가 각각 별도 시료/.test(m)));
  // 규칙을 비우면(설정) 오류가 사라진다
  const off = runReview({ company: 'gyeryong', cfg: mergeConfig({ bundleRules: { single: [], onlyWith: [] } }), estimateWb: unitPriceWb({ blocks: [block] }) }).estimate.filter((x) => x.category === '다성분' && x.severity === 'error');
  assert.deepEqual(off, []);
});

test('설정 검증: 묶음 규칙은 문자열 목록, 묶음은 인자 2개 이상', () => {
  assert.deepEqual(validateConfig(mergeConfig({})), []);
  assert.ok(validateConfig(mergeConfig({ bundleRules: { single: [''], onlyWith: [] } })).length);
  assert.ok(validateConfig(mergeConfig({ bundleRules: { single: [], onlyWith: [['수산화나트륨']] } })).length);
});

test('기본 묶음 규칙: 기타광물성분진·규산염(포틀랜드시멘트)·유리섬유는 함께 묶을 수 있고, 용접흄·주석(유기화합물)·산화아연(분진)은 단성분', async () => {
  const { bundleViolations } = await import('../src/core/bundle-rules.js');
  assert.deepEqual(bundleViolations(['기타광물성분진', '규산염(포틀랜드시멘트)', '유리섬유']), []);
  for (const single of ['용접흄및분진', '주석(유기화합물)', '산화아연(분진)']) assert.match(bundleViolations([single, '기타광물성분진'])[0], /단성분/);
  // 산화아연 과 산화아연(분진) 은 다른 인자 — 산화아연은 다른 인자와 묶여도 된다
  assert.deepEqual(bundleViolations(['산화아연', '망간및그무기화합물']), []);
  assert.equal(bundleViolations(['산화아연(분진)', '산화아연']).length, 1);
});

test('엑셀 분류별 정리: 같은 분류끼리 묶고(오류 많은 순), 같은 내용은 한 행(위치 여러 개), 긴 문장은 내용/사유로 나눈다', async () => {
  const { groupFindings, detailRows, splitMessage } = await import('../src/core/findings-table.js');
  const m = '계획서 [배관] 주석(유기화합물) 은(는) 단성분 분석이라 묶을 수 없습니다 (함께 묶인 인자: 산화철분진과흄, 알루미늄(금속분진)) — 원인: 한 시료(3건)';
  assert.deepEqual(splitMessage(m), { head: '계획서 [배관] 주석(유기화합물) 은(는) 단성분 분석이라 묶을 수 없습니다', detail: ['함께 묶인 인자: 산화철분진과흄, 알루미늄(금속분진)', '원인: 한 시료(3건)'] });
  const fs = [
    { severity: 'warn', category: '단가', message: 'A', where: '1행' },
    { severity: 'error', category: '다성분', message: m, where: '23행', file: 'a.xlsx' },
    { severity: 'error', category: '다성분', message: m, where: '59행', file: 'a.xlsx' },
    { severity: 'error', category: '재료비 0원', message: 'B', where: '9행' },
    { severity: 'error', category: '재료비 0원', message: 'C', where: '10행' },
  ];
  const g = groupFindings(fs);
  assert.deepEqual(g.map((c) => [c.category, c.error, c.warn]), [['재료비 0원', 2, 0], ['다성분', 1, 0], ['단가', 0, 1]]); // 오류 많은 순
  const rows = detailRows(fs, ['견적서 검토']);
  assert.equal(rows.length, 4); // 다성분 2건은 한 행으로 합쳐짐
  const dup = rows.find((r) => r[1] === '다성분');
  assert.equal(dup[6], 2); assert.equal(dup[5], '23행 · a.xlsx\n59행 · a.xlsx'); assert.match(dup[4], /함께 묶인 인자: 산화철분진과흄/);
});
