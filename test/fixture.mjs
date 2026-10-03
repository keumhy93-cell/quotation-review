// 현대건설 견적 엑셀과 같은 시트명/셀 위치로 만든 테스트용 통합문서
import XLSX from 'xlsx';
const G = '1. (출력)표준품셈 작업환경측정 견적서', L = '1-2. (출력)인건비 세부산출내역서', D = '1-3 (출력)직접경비 세부산출내역서';
const M = '재료비 세부산출내역서(사업장보고용)', P = '작업환경측정 계획서(사업장보고용)';
const put = (ws, a, v, f) => { ws[a] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) }; if (f) ws[a].f = f; };
const fin = (ws, maxA) => { ws['!ref'] = `A1:${maxA}`; return ws; };

export function hyundaiWb({
  period = '정기', mode = '자동', factor = period === '정기' ? 0.8 : 0.55,
  wage = period === '정기' ? [347410, 311177, 260926, 234568] : [260926, 234568, 260926, 234568],
  plan = [], mat = [], laborMeasure = { 소음노출량계: 0 }, laborAnalysis = {}, persons = 0, hardcodeGap = false, matTotalOverride, manual = null, nego = 0, negoAfter = false, site = null,
} = {}) {
  const wb = XLSX.utils.book_new();
  const add = (n, ws) => XLSX.utils.book_append_sheet(wb, ws, n);
  const matSum = mat.reduce((a, r) => a + (r[7] ?? ((r[5] || 0) + (r[6] || 0))), 0);
  const labor = 1000000, direct = labor * 0.1 + labor * 0.07777 + matSum;
  const g = {};
  put(g, 'C2', `2026년 작업환경측정 ${period} 견적서`);
  if (site) put(g, 'A10', site);
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

export const toBytes = (wb) => new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

/** 계룡·한화 형태의 수수료 산출근거 통합문서 (현장 블록 1개 이상). blocks: [{no,name,period,workers,rows:[[공종,유해인자,분류,방법,근로자,건수,단가]]}] */
export function unitPriceWb({ blocks, status = true, sheetName = '수수료 산출근거(계룡건설)' } = {}) {
  const wb = XLSX.utils.book_new();
  const t = {}; put(t, 'C7', '1-49인'); put(t, 'D7', 415500); put(t, 'C8', '50-99인'); put(t, 'D8', 660000);
  put(t, 'C18', '중량분석법(분진)'); put(t, 'D18', 37120); put(t, 'C19', '소음노출량계'); put(t, 'D19', 21900); put(t, 'C20', 'FTIR법(단성분)'); put(t, 'D20', 70500); t['!ref'] = 'B2:D62';
  const f = {}; let r = 5; const sum = [];
  for (const b of blocks) {
    put(f, `A${r}`, `No. ${b.no}`); put(f, `A${r + 1}`, '현장명'); put(f, `B${r + 1}`, b.name); put(f, `D${r + 1}`, '측정구분'); put(f, `E${r + 1}`, `2026년 상반기 (${b.period || '정기'}) 측정`);
    const base = b.workers <= 49 ? 415500 : 660000;
    put(f, `A${r + 5}`, '총 근로자수'); put(f, `B${r + 5}`, b.workers); put(f, `C${r + 5}`, '사업장 규모'); put(f, `D${r + 5}`, b.workers <= 49 ? '1-49인' : '50-99인'); put(f, `E${r + 5}`, base, 'VLOOKUP(1,2,3)'); put(f, `G${r + 5}`, 1); put(f, `H${r + 5}`, base);
    put(f, `A${r + 8}`, '공종'); put(f, `B${r + 8}`, '유해인자'); put(f, `D${r + 8}`, '구분');
    let rr = r + 9, tot = 0;
    for (const [gong, hz, cat, method, workers, n, price] of b.rows) {
      put(f, `A${rr}`, gong); put(f, `B${rr}`, hz); put(f, `C${rr}`, cat); put(f, `D${rr}`, method); put(f, `F${rr}`, workers); put(f, `G${rr}`, n); put(f, `H${rr}`, price, 'VLOOKUP(1,2,3)'); put(f, `I${rr}`, n * price); tot += n * price; rr++;
    }
    put(f, `A${rr}`, '측정분석 수수료 합계'); put(f, `H${rr}`, tot); put(f, `A${rr + 2}`, '작업환경측정 수수료 합계'); put(f, `E${rr + 2}`, tot + base); put(f, `A${rr + 4}`, '최종 수수료 계'); put(f, `E${rr + 4}`, tot + base);
    sum.push({ ...b, fee: tot + base }); r = rr + 7;
  }
  f['!ref'] = `A1:J${r}`;
  XLSX.utils.book_append_sheet(wb, t, '단가'); XLSX.utils.book_append_sheet(wb, f, sheetName);
  if (status) XLSX.utils.book_append_sheet(wb, statusSheet('gyeryong', sum.map((b) => ({ name: b.name, kind: b.period || '정기', fee: b.fee, hazards: ['소음', '분진'], org: '인천센터' }))), '실시현황');
  return wb;
}

/** 실시현황 시트 (계룡/한화: No|예비조사일|본측정일|소요일|현장명|주소|구분|평가|인자|측정기관|담당자|최종수수료[|비고], 현대: 총근로자수·직접경비 열 추가) */
export function statusSheet(company, sites, title = '■ 2026년 2/4분기 작업환경측정 실시현황') {
  const ws = {};
  const hy = company === 'hyundai';
  const heads = hy
    ? ['No.', '예비조사일', '본측정일', '소요일', '[현장코드]현장명', '주소', '구분', '총 근로자 수', '평가', '인자', '특별관리물질을 함유한\n화학물질명', '특별관리물질\n유해인자', '측정기관', '측정\n담당자', '직접경비', '', '', '최종수수료(원)']
    : ['No.', '예비조사일', '본측정일', '소요일', '현장명', '주소', '구분', '평가', '인자', '측정기관', '측정\n담당자', '최종수수료(원)', ...(company === 'gyeryong' ? ['비고'] : [])];
  put(ws, 'A2', title); put(ws, 'B3', '(정렬기준 : 본측정일)');
  heads.forEach((h, c) => { if (h) put(ws, XLSX.utils.encode_cell({ r: 4, c }), h); });
  let r = hy ? 6 : 5;
  if (hy) { put(ws, 'O6', '출장여비'); put(ws, 'P6', '감가상각비'); put(ws, 'Q6', '재료비'); }
  const col = (k) => ({ no: 0, prelim: 1, date: 2, days: 3, name: 4, address: 5, kind: 6, workers: 7, eval: hy ? 8 : 7, hazard: hy ? 9 : 8, org: hy ? 12 : 9, person: hy ? 13 : 10, fee: hy ? 17 : 11, note: 12 }[k]);
  const setN = (a, v, z) => { ws[a] = { t: 'n', v }; if (z) ws[a].z = z; };
  sites.forEach((s, i) => {
    const hz = s.hazards || ['소음'];
    const A = (k) => XLSX.utils.encode_cell({ r, c: col(k) });
    setN(A('no'), s.no ?? i + 1); setN(A('prelim'), s.prelim ?? 46099, 'm"/"d;@'); setN(A('date'), s.date ?? 46114 + i, 'm"/"d;@'); setN(A('days'), 1);
    put(ws, A('name'), s.name); put(ws, A('address'), s.address || '주소'); put(ws, A('kind'), s.kind || '정기'); if (hy) setN(A('workers'), s.workers ?? 10);
    put(ws, A('org'), s.org || '인천센터'); put(ws, A('person'), s.person || '담당'); setN(A('fee'), s.fee ?? 1000000, '#,##0');
    hz.forEach((h, k) => { put(ws, XLSX.utils.encode_cell({ r: r + k, c: col('eval') }), s.eval || '미만'); put(ws, XLSX.utils.encode_cell({ r: r + k, c: col('hazard') }), h); });
    if (hz.length > 1) { const widthC = heads.length; const merges = (ws['!merges'] ||= []); for (let c = 0; c < widthC; c++) if (c !== col('eval') && c !== col('hazard')) merges.push({ s: { r, c }, e: { r: r + hz.length - 1, c } }); }
    r += hz.length;
  });
  ws['!ref'] = `A1:${XLSX.utils.encode_col(heads.length - 1)}${r}`;
  const merges = (ws['!merges'] ||= []);
  if (hy) heads.forEach((h, c) => { if (c !== 14 && c !== 15 && c !== 16) merges.push({ s: { r: 4, c }, e: { r: 5, c } }); }); merges.push(...(hy ? [{ s: { r: 4, c: 14 }, e: { r: 4, c: 16 } }] : []));
  return ws;
}
export function statusWb(company, sites, title) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, statusSheet(company, sites, title), '실시현황'); return wb;
}
