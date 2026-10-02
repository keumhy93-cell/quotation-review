// 현대건설 견적 엑셀과 같은 시트명/셀 위치로 만든 테스트용 통합문서
import XLSX from 'xlsx';
const G = '1. (출력)표준품셈 작업환경측정 견적서', L = '1-2. (출력)인건비 세부산출내역서', D = '1-3 (출력)직접경비 세부산출내역서';
const M = '재료비 세부산출내역서(사업장보고용)', P = '작업환경측정 계획서(사업장보고용)';
const put = (ws, a, v, f) => { ws[a] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) }; if (f) ws[a].f = f; };
const fin = (ws, maxA) => { ws['!ref'] = `A1:${maxA}`; return ws; };

export function hyundaiWb({
  period = '정기', mode = '자동', factor = period === '정기' ? 0.8 : 0.55,
  wage = period === '정기' ? [347410, 311177, 260926, 234568] : [260926, 234568, 260926, 234568],
  plan = [], mat = [], laborMeasure = { 소음노출량계: 0 }, laborAnalysis = {}, persons = 0, hardcodeGap = false, matTotalOverride, manual = null, nego = 0, negoAfter = false,
} = {}) {
  const wb = XLSX.utils.book_new();
  const add = (n, ws) => XLSX.utils.book_append_sheet(wb, ws, n);
  const matSum = mat.reduce((a, r) => a + (r[7] ?? ((r[5] || 0) + (r[6] || 0))), 0);
  const labor = 1000000, direct = labor * 0.1 + labor * 0.07777 + matSum;
  const g = {};
  put(g, 'C2', `2026년 작업환경측정 ${period} 견적서`);
  put(g, 'A16', '직접인건비'); put(g, 'K16', labor, hardcodeGap ? null : `'${L}'!AY63`);
  put(g, 'A17', '직접경비'); put(g, 'K17', Math.round(direct), hardcodeGap ? null : `'${D}'!U19`);
  put(g, 'A18', '조정금액(NEGO)'); put(g, 'K18', nego);
  put(g, 'A19', '견 적 금 액');
  const sum = labor + Math.round(direct);
  if (negoAfter) put(g, 'AA19', Math.floor((sum * factor) / 100) * 100 - nego, `ROUNDDOWN((K16+K17)*${factor},-2)-K18`);
  else put(g, 'AA19', Math.floor(((sum - nego) * factor) / 100) * 100, `ROUNDDOWN((K16+K17-K18)*${factor},-2)`);
  add(G, fin(g, 'AS77'));

  const l = {}; put(l, 'A7', '측정 대상 인원(인)'); put(l, 'L7', persons, `SUM('${P}'!F8:F1000)`);
  let r = 19;
  for (const [k, v] of Object.entries(laborMeasure)) { put(l, `A${r}`, `4.1 ${k}`); put(l, `R${r}`, v, `SUMIF('${P}'!$C$8:$C$1000,"${k}",'${P}'!$E$8:$E$1000)`); r++; }
  r = 36;
  for (const [k, v] of Object.entries(laborAnalysis)) { put(l, `A${r}`, `5. ${k}`); put(l, `R${r}`, v, `SUMIF('${M}'!$E$8:$E$1000,"${k}",'${M}'!$D$8:$D$1000)`); r++; }
  ['특급', '고급', '중급', '초급'].forEach((n, i) => { put(l, `A${59 + i}`, `${n}기술자`); put(l, `R${59 + i}`, wage[i], String(wage[i])); });
  put(l, 'A63', '계'); put(l, 'AY63', labor, 'ROUNDDOWN(SUM(AY59:BO62),-10)');
  add(L, fin(l, 'CE121'));

  const d = {}; put(d, 'A16', '합계'); put(d, 'U16', matTotalOverride ?? matSum); put(d, 'A19', '직접경비 합계'); put(d, 'U19', Math.round(direct));
  add(D, fin(d, 'AV76'));

  const m = {};
  ['연번', '구분', '유해인자', '측정건수', '분석방법', '측정재료비(원)', '분석재료비(원)', '합계(원)'].forEach((h, i) => put(m, XLSX.utils.encode_cell({ r: 5, c: i }), h));
  put(m, 'A7', '합계'); put(m, 'H7', matSum);
  mat.forEach((row, i) => row.forEach((v, c) => { if (v != null) put(m, XLSX.utils.encode_cell({ r: 7 + i, c }), v); }));
  add(M, fin(m, 'K136'));

  const p = {};
  const hdr = ['구분', '측정대상 유해인자', '측정방법', '근로자수(명)', '측정건수(건)', '측정인원수(명)'];
  hdr.forEach((h, i) => put(p, XLSX.utils.encode_cell({ r: 6, c: i }), h));
  plan.forEach((row, i) => row.forEach((v, c) => { if (v != null) put(p, XLSX.utils.encode_cell({ r: 7 + i, c }), v); }));
  if (manual) {
    ['구분', '유해인자 입력', '종류선택(매체/분석기기 포함)', '측정방법', '근로자수(명)', '측정건수(건)', '측정인원수(명)'].forEach((h, i) => put(p, XLSX.utils.encode_cell({ r: 6, c: 7 + i }), h));
    manual.forEach((row, i) => row.forEach((v, c) => { if (v != null) put(p, XLSX.utils.encode_cell({ r: 7 + i, c: 7 + c }), v); }));
  }
  add(P, fin(p, 'O1000'));
  add(mode === '자동' ? '소음제외 붙여넣기(컨트롤+A)' : '_연동헬퍼', fin({}, 'A1'));
  return wb;
}
