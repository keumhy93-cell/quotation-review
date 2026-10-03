/**
 * 연도별 단가표(노임단가·재료비단가·기본관리비·기본단가) 등록·적용.
 *
 * priceBook = { years: { "2026": { hyundai:{ wage:{정기:{특급기술자:…},수시:{…}}, factor:{정기,수시}, material:{유해인자:[측정,분석개별,분석중복,계,수정재료비,시약]}, travelRate, depRate, source, updatedAt },
 *                                  gyeryong:{ base:[{label,range,price}], methods:{규격:단가}, source, updatedAt }, hanwha:{…} } },
 *               events:[{ts,by,text}] }
 * 가져오는 방법: ① 견적 엑셀(현대 .xlsm: 노임단가·재료비단가·계수·요율 / 단가제: '단가' 시트) ② 양식 엑셀(templateWorkbook)
 */
import { XLSX } from './xlsx.js';
import { parseHyundai } from './hyundai.js';
import { extractContract } from './unitprice.js';
import { norm, toNum, readSheets } from './util.js';

export const GRADES = ['특급기술자', '고급기술자', '중급기술자', '초급기술자'];
export const PERIODS = ['정기', '수시'];
export const COMPANY_NAME = { hyundai: '현대건설', gyeryong: '계룡건설', hanwha: '한화건설' };
const MAT_HEAD = ['유해인자', '측정', '분석(개별)', '분석(중복)', '계', '수정재료비', '시약 및 소모품비'];
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const clone = (o) => JSON.parse(JSON.stringify(o));

export const emptyBook = () => ({ years: {}, events: [] });
/** '2026-2분기' → 2026 (없으면 올해) */
export const yearOf = (period, now = new Date()) => { const m = String(period ?? '').match(/(20\d\d)/); return m ? Number(m[1]) : now.getFullYear(); };

// ── 가져오기 ①: 견적 엑셀
export function extractHyundai(wb, file = '') {
  const p = parseHyundai(wb);
  if (!p.has.labor || !p.labor?.rates?.length) throw new Error('인건비 세부산출내역서의 노임단가를 찾지 못했습니다. 현대건설 견적서(엑셀)가 맞는지 확인하세요.');
  const out = { file, period: p.period || null, wage: null, factor: p.gap?.total?.factor ?? null, material: p.priceRows || {}, travelRate: p.rates?.travel ?? null, depRate: p.rates?.dep ?? null };
  const wage = {}; for (const r of p.labor.rates) wage[r.grade] = r.price;
  if (GRADES.every((g) => wage[g] > 0)) out.wage = wage;
  if (!out.period) throw new Error('견적서 제목에서 정기/수시를 알 수 없습니다.');
  if (!out.wage) throw new Error('특급~초급 노임단가 4개를 모두 읽지 못했습니다.');
  return out;
}
export function extractUnitPrice(wb, file = '') { const c = extractContract(wb); return { file, base: c.base, methods: c.methods }; }

// ── 가져오기 ②: 양식 엑셀
export function templateWorkbook(year, y = {}) {
  const hy = y.hyundai || {}, wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add('안내', [[`${year}년 단가표 등록 양식`], [], ['· 시트별로 값을 채워 「단가 등록」 화면에서 올리면 해당 연도 단가표로 저장됩니다. 비워 둔 시트는 기존 등록값을 건드리지 않습니다.'], ['· 노임단가/계수·요율/재료비단가(현대건설), 기본관리비/기본단가(계룡·한화) — 첫 줄(머리글)은 지우지 마세요.'], ['· 금액은 숫자만 입력합니다(콤마·원 표시 가능).']], [100]);
  const wageRows = [['구분', '직급', '노임단가']];
  for (const per of PERIODS) for (const g of GRADES) wageRows.push([per, g, hy.wage?.[per]?.[g] ?? '']);
  add('노임단가', wageRows, [8, 14, 14]);
  add('계수·요율', [['항목', '구분', '값'], ['견적금액 계수', '정기', hy.factor?.정기 ?? ''], ['견적금액 계수', '수시', hy.factor?.수시 ?? ''], ['출장여비율', '', hy.travelRate ?? ''], ['감가상각률', '', hy.depRate ?? '']], [16, 8, 12]);
  add('재료비단가(현대)', [MAT_HEAD, ...Object.entries(hy.material || {}).map(([k, v]) => [k, ...v])], [44, 10, 12, 12, 10, 12, 16]);
  const baseRows = [['건설사', '규모', '금액']], methRows = [['건설사', '규격', '단가']];
  for (const c of ['gyeryong', 'hanwha']) {
    for (const b of y[c]?.base || []) baseRows.push([COMPANY_NAME[c], b.label, b.price]);
    for (const [k, v] of Object.entries(y[c]?.methods || {})) methRows.push([COMPANY_NAME[c], k, v]);
  }
  add('기본관리비', baseRows, [10, 14, 14]); add('기본단가(분석)', methRows, [10, 36, 12]);
  return wb;
}

const companyOf = (s) => (/계룡/.test(s) ? 'gyeryong' : /한화/.test(s) ? 'hanwha' : null);
/** 양식 엑셀 → 부분 연도 데이터 { hyundai?:{wage?,factor?,material?,travelRate?,depRate?}, gyeryong?:{base?,methods?}, hanwha?:{…} } + 경고 */
export function parseTemplate(wb) {
  const sheets = readSheets(wb), out = {}, warnings = [];
  const body = (name) => { const s = sheets.find((x) => x.name.includes(name)); return s ? s.rows.slice(1).filter((r) => r && r.some((v) => v != null && v !== '')) : null; };
  const num = (v) => { const n = toNum(v); return n != null && n >= 0 ? n : null; };

  const wage = body('노임단가');
  if (wage) {
    const w = {};
    for (const r of wage) { const per = String(r[0] ?? '').trim(), g = String(r[1] ?? '').trim(), n = num(r[2]); if (!PERIODS.includes(per) || !GRADES.includes(g)) { if (per || g) warnings.push(`노임단가: '${per} ${g}' 행을 건너뜀`); continue; } if (n == null || n <= 0) { if (r[2] !== '' && r[2] != null) warnings.push(`노임단가: ${per} ${g} 금액이 올바르지 않습니다`); continue; } (w[per] ||= {})[g] = n; }
    for (const per of Object.keys(w)) if (!GRADES.every((g) => w[per][g])) { warnings.push(`노임단가: ${per} 은(는) 특급~초급 4개가 모두 있어야 저장됩니다 — 제외`); delete w[per]; }
    if (Object.keys(w).length) (out.hyundai ||= {}).wage = w;
  }
  const rate = body('계수');
  if (rate) for (const r of rate) {
    const item = String(r[0] ?? ''), per = String(r[1] ?? '').trim(), n = num(r[2]); if (n == null || !n) continue;
    if (/견적금액\s*계수/.test(item) && PERIODS.includes(per)) { if (n > 1) warnings.push(`견적금액 계수 ${per} ${n} 는 1 이하여야 합니다`); else ((out.hyundai ||= {}).factor ||= {})[per] = n; }
    else if (/출장/.test(item)) { if (n > 1) warnings.push('출장여비율은 1 이하(예: 0.1)'); else (out.hyundai ||= {}).travelRate = n; }
    else if (/감가/.test(item)) { if (n > 1) warnings.push('감가상각률은 1 이하(예: 0.07777)'); else (out.hyundai ||= {}).depRate = n; }
  }
  const mat = body('재료비단가');
  if (mat?.length) {
    const m = {}; let bad = 0;
    for (const r of mat) { const name = String(r[0] ?? '').trim(); const v = [1, 2, 3, 4, 5, 6].map((k) => num(r[k])); if (!name || v.slice(0, 3).some((x) => x == null)) { bad++; continue; } m[name] = v.map((x) => x ?? 0); }
    if (bad) warnings.push(`재료비단가: ${bad}행은 이름이나 금액이 비어 건너뜀`);
    if (Object.keys(m).length) (out.hyundai ||= {}).material = m;
  }
  const base = body('기본관리비'), meth = body('기본단가');
  for (const [rows, key] of [[base, 'base'], [meth, 'methods']]) if (rows) for (const r of rows) {
    const co = companyOf(String(r[0] ?? '')), label = String(r[1] ?? '').trim(), n = num(r[2]);
    if (!co || !label || n == null) { warnings.push(`${key === 'base' ? '기본관리비' : '기본단가'}: '${r[0] ?? ''} ${label}' 행을 건너뜀 (건설사·이름·금액 확인)`); continue; }
    const t = (out[co] ||= {});
    if (key === 'base') { const m = label.match(/(\d+)\s*-\s*(\d+)/); if (!m) { warnings.push(`기본관리비: 규모 '${label}' 는 '1-49인' 형식이어야 합니다`); continue; } (t.base ||= []).push({ label, range: [Number(m[1]), Number(m[2])], price: n }); }
    else (t.methods ||= {})[label] = n;
  }
  if (!Object.keys(out).length) warnings.push('읽을 수 있는 단가가 없습니다. 양식(시트 이름·머리글)을 확인하세요.');
  return { data: out, warnings };
}

// ── 병합·비교
const diffMap = (a = {}, b = {}) => { let changed = 0, added = 0, removed = 0; for (const k of Object.keys(b)) { if (!(k in a)) added++; else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed++; } for (const k of Object.keys(a)) if (!(k in b)) removed++; return { changed, added, removed }; };

/** 한 건설사·한 연도에 incoming 을 반영한 새 값과 변경 내역(사람이 읽는 줄) */
export function mergeCompany(company, existing = {}, incoming = {}, source = '') {
  const next = clone(existing), changes = [];
  const say = (t) => changes.push(t);
  if (company === 'hyundai') {
    if (incoming.wage) for (const per of Object.keys(incoming.wage)) {
      next.wage ||= {};
      for (const g of GRADES) { const o = next.wage[per]?.[g], n = incoming.wage[per][g]; if (o == null) say(`노임단가 ${per} ${g}: 신규 ${won(n)}`); else if (o !== n) say(`노임단가 ${per} ${g}: ${won(o)} → ${won(n)}`); }
      next.wage[per] = { ...incoming.wage[per] };
    }
    if (incoming.factor) for (const per of Object.keys(incoming.factor)) { next.factor ||= {}; const o = next.factor[per], n = incoming.factor[per]; if (o == null) say(`견적금액 계수 ${per}: 신규 ${n}`); else if (o !== n) say(`견적금액 계수 ${per}: ${o} → ${n}`); next.factor[per] = n; }
    for (const [k, label] of [['travelRate', '출장여비율'], ['depRate', '감가상각률']]) if (incoming[k] != null) { const o = next[k]; if (o == null) say(`${label}: 신규 ${incoming[k]}`); else if (o !== incoming[k]) say(`${label}: ${o} → ${incoming[k]}`); next[k] = incoming[k]; }
    if (incoming.material && Object.keys(incoming.material).length) { const d = diffMap(next.material, incoming.material); if (d.changed || d.added || d.removed) say(`재료비단가 ${Object.keys(incoming.material).length}종 (변경 ${d.changed} · 추가 ${d.added} · 제거 ${d.removed})`); next.material = incoming.material; }
  } else {
    if (incoming.base?.length) { const o = Object.fromEntries((next.base || []).map((b) => [b.label, b.price])), n = Object.fromEntries(incoming.base.map((b) => [b.label, b.price])); const d = diffMap(o, n); if (d.changed || d.added || d.removed) say(`기본관리비 ${incoming.base.length}구간 (변경 ${d.changed} · 추가 ${d.added} · 제거 ${d.removed})`); for (const [k, v] of Object.entries(n)) if (k in o && o[k] !== v) say(`  ${k}: ${won(o[k])} → ${won(v)}`); next.base = incoming.base; }
    if (incoming.methods && Object.keys(incoming.methods).length) { const d = diffMap(next.methods, incoming.methods); if (d.changed || d.added || d.removed) say(`기본단가(분석수수료) ${Object.keys(incoming.methods).length}종 (변경 ${d.changed} · 추가 ${d.added} · 제거 ${d.removed})`); for (const [k, v] of Object.entries(incoming.methods)) if (next.methods && k in next.methods && next.methods[k] !== v) say(`  ${k}: ${won(next.methods[k])} → ${won(v)}`); next.methods = incoming.methods; }
  }
  if (changes.length) { next.updatedAt = new Date().toISOString(); next.source = { ...(next.source || {}), [company]: source }; }
  return { next, changes };
}

export function validateYear(yearData = {}) {
  const errs = [];
  const hy = yearData.hyundai;
  if (hy?.wage) for (const per of PERIODS) if (hy.wage[per]) for (const g of GRADES) if (!(hy.wage[per][g] > 0)) errs.push(`${per} ${g} 노임단가가 올바르지 않습니다.`);
  for (const per of PERIODS) { const f = hy?.factor?.[per]; if (f != null && !(f > 0 && f <= 1)) errs.push(`${per} 견적금액 계수는 0 초과 1 이하여야 합니다.`); }
  return errs;
}

/** 등록 현황 요약(화면 칩) */
export function summarizeYear(y = {}) {
  const hy = y.hyundai || {};
  return {
    hyundai: { wage: PERIODS.filter((p) => hy.wage?.[p]), factor: PERIODS.filter((p) => hy.factor?.[p] != null), material: Object.keys(hy.material || {}).length, rates: hy.travelRate != null && hy.depRate != null },
    gyeryong: { base: (y.gyeryong?.base || []).length, methods: Object.keys(y.gyeryong?.methods || {}).length },
    hanwha: { base: (y.hanwha?.base || []).length, methods: Object.keys(y.hanwha?.methods || {}).length },
  };
}

/**
 * 검토에 쓸 설정으로 변환: 해당 연도 단가표가 있으면 cfg 의 노임단가·계수·재료비단가·계약단가를 덮어쓴다.
 * @returns {{cfg, notes:string[], year}}  notes = 화면에 보여 줄 안내(어느 연도 단가표를 썼는지 / 빠진 항목)
 */
export function applyPriceBook(cfg, book, company, year) {
  const out = clone(cfg), notes = [];
  const y = book?.years?.[String(year)];
  if (!y) { notes.push(`${year}년 단가표가 등록되지 않아 기준 관리의 기본값을 사용했습니다 (단가 등록 화면에서 등록하세요).`); return { cfg: out, notes, year }; }
  if (company === 'hyundai') {
    const hy = y.hyundai || {}, rates = out.companies.hyundai.rates;
    for (const per of PERIODS) {
      if (hy.wage?.[per]) rates[per].wage = { ...rates[per].wage, ...hy.wage[per] }; else notes.push(`${year}년 ${per} 노임단가가 등록되지 않았습니다 (기본값 사용).`);
      if (hy.factor?.[per] != null) rates[per].factor = hy.factor[per];
    }
    if (hy.material && Object.keys(hy.material).length) out.materialPrices = hy.material; else notes.push(`${year}년 재료비단가표가 등록되지 않아 재료비 단가 대조는 생략했습니다.`);
    if (hy.travelRate != null) out.companies.hyundai.travelRate = hy.travelRate;
    if (hy.depRate != null) out.companies.hyundai.depRate = hy.depRate;
  } else if (y[company] && (y[company].base?.length || Object.keys(y[company].methods || {}).length)) {
    out.companies[company].contract = { base: y[company].base || [], methods: y[company].methods || {} };
  } else notes.push(`${year}년 ${COMPANY_NAME[company]} 기본관리비·기본단가가 등록되지 않아 견적 파일 안의 단가표 기준으로 검증했습니다.`);
  return { cfg: out, notes, year };
}
