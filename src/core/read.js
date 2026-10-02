import { XLSX } from './xlsx.js';

/** 현대 견적서(.xlsm)는 별5·별6 등 숨김 시트가 수만 행이라 전체를 읽으면 20초 가까이 걸린다 → 필요한 시트만 읽는다 */
const HYUNDAI_WANT = /표준품셈|인건비|직접경비|재료비|계획서|재집|^유해인자|_연동헬퍼|소음제외|실시현황|^단가$/;
const HYUNDAI_SKIP = /산출표|붙여넣기/;

/**
 * @param {ArrayBuffer|Uint8Array|Buffer} data
 * @param {{select?: 'hyundai'|'all'}} opt
 */
export function loadWorkbook(data, { select = 'all', type } = {}) {
  const t = type || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data) ? 'buffer' : 'array');
  if (select === 'hyundai') {
    const names = XLSX.read(data, { type: t, bookSheets: true }).SheetNames;
    const pick = names.filter((n) => (HYUNDAI_WANT.test(n) && !HYUNDAI_SKIP.test(n)) || /재집/.test(n));
    // 사업장 제출용 파일처럼 이름이 다른 경우(작업환경측정계획서/측정및분석재료비)는 전체를 읽는다
    if (pick.length >= 4) return XLSX.read(data, { type: t, cellFormula: true, sheets: pick });
  }
  return XLSX.read(data, { type: t, cellFormula: true });
}
