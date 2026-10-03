/** 결과서(PDF)의 '공정별 화학물질 사용 상태' 표 → 행 추출, 기관 전체 취합본(엑셀) 생성 */
import { XLSX } from './xlsx.js';
import { siteKey } from './status.js';

const UNIT = '(?:kg|g|mg|ℓ|L|l|mL|ml|t|톤|개|통|캔|말|포|EA|ea)';
/** '용접봉 사용 용접용 2 kg 이산화티타늄, 망간 함유' → 칸 분리(실패하면 원문만) */
export function splitUsage(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const m = t.match(new RegExp(`^(.*?)\\s+(제조\\/사용|제조|사용)\\s+(.*?)\\s+(\\d[\\d.,]*\\s*${UNIT}\\S*)\\s*(.*)$`));
  if (!m) return { product: '', kind: '', purpose: '', amount: '', note: '', raw: t };
  return { product: m[1], kind: m[2], purpose: m[3], amount: m[4], note: m[5], raw: t };
}

/** 파싱된 결과서(PDF) 한 건 → 사용실태 행들 */
export function usageRowsOf(res, ctx = {}) {
  if (res.kind !== 'pdf') return [];
  return (res.usageRows || []).map((r) => ({
    org: ctx.org || '', site: res.cover?.site || '', file: res.file, date: res.cover?.date || '', period: res.cover?.period || '',
    dept: r.dept || '', ...splitUsage(r.text),
    measured: [...new Set((res.plan || []).filter((p) => p.dept === r.dept).map((p) => p.hazard))].join(', '),
  }));
}

export const USAGE_HEADER = ['연번', '기관', '현장명', '측정일', '구분', '부서 또는 공정명', '화학물질명(상품명)', '제조·사용', '사용 용도', '월 취급량', '비고', '측정 유해인자(해당 부서)', '결과서 파일', '원문'];

/** rows 는 이미 원하는 순서(= 실시현황 연번 순서)로 정렬해서 넘긴다 */
export function usageToWorkbook(rows, title = '사용실태 취합') {
  const aoa = [[title], [], USAGE_HEADER];
  rows.forEach((r, i) => aoa.push([i + 1, r.org, r.site, r.date, r.period, r.dept, r.product, r.kind, r.purpose, r.amount, r.note, r.measured, r.file, r.raw]));
  if (!rows.length) aoa.push(['', '', '취합된 사용실태가 없습니다 (결과서에 "해당 사항 없음" 이거나 결과서가 없음)']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [6, 12, 36, 16, 6, 16, 22, 8, 16, 10, 28, 30, 30, 50].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '사용실태');
  return wb;
}

/** 현장 순서(실시현황 연번)에 맞춰 사용실태 행 정렬 */
export function orderUsage(rows, orderedSiteNames = []) {
  const idx = (site) => { const k = siteKey(site); const i = orderedSiteNames.findIndex((n) => { const o = siteKey(n); return o && (o === k || o.includes(k) || k.includes(o)); }); return i < 0 ? 1e9 : i; };
  return [...rows].map((r, i) => ({ r, i })).sort((a, b) => idx(a.r.site) - idx(b.r.site) || a.i - b.i).map((x) => x.r);
}
