/**
 * 현대건설(표준품셈) 견적 엑셀 전용 파서 + 검증.
 * 대상 양식: 정기/수시 × 자동/수동 4종 (시트 구조는 4종이 동일 골격)
 *  - 갑지  '1. (출력)표준품셈 작업환경측정 견적서'  K16 직접인건비 / K17 직접경비 / K18 NEGO / AA19 견적금액(=…*0.8|0.55)
 *  - 인건비 '1-2. (출력)인건비 세부산출내역서'      L7 대상인원 / R19~ 방법별 건수(SUMIF) / R59~R62 노임단가 / AY63 합계
 *  - 직접경비 '1-3 (출력)직접경비 세부산출내역서'    재료비 합계 → 직접경비 합계
 *  - 계획서  '작업환경측정 계획서(사업장보고용)'      구분|유해인자|측정방법|근로자수|측정건수|측정인원수 (수동은 H~N 에 직접입력 블록)
 *  - 재료비  '재료비 세부산출내역서(사업장보고용)'    연번|구분(측정/공시료)|유해인자|측정건수|분석방법|측정재료비|분석재료비|합계
 *  - 숨김 '별4.재집'(유해인자별 단가표), '유해인자'/'유해인자목록'(마스터 명칭)
 */
import { readSheets, readTable, findHeader, norm, toNum, splitLines, isBlankSample, finding as F, diffMaps, expectedSamples } from './util.js';

const PLAN = {
  kind: ['구분'], media: ['종류선택'], hazard: ['유해인자'], method: ['측정방법'],
  people: ['측정인원수'], workers: ['근로자수'], samples: ['측정건수'],
};
const MAT = {
  seq: ['연번', '순번'], kind: ['구분'], hazard: ['유해인자'], count: ['측정건수'],
  method: ['분석방법'], mAmt: ['측정재료비'], aAmt: ['분석재료비'], amount: ['합계'],
};

const byName = (sheets, ...keys) => sheets.find((s) => keys.every((k) => s.name.includes(k)));
const baseName = (s) => String(s ?? '').replace(/공시료|blank/gi, '').trim();
const key = (s) => norm(baseName(s));
// SUMIF 조건은 공백까지 정확히 일치해야 집계되므로 공백은 보존
const short = (s) => norm(String(s ?? '').split('/')[0]);
const cn = (s) => String(s ?? '').trim().toLowerCase();
const labelRow = (sheet, label) => {
  const i = sheet.rows.findIndex((r) => (r || []).some((v) => typeof v === 'string' && norm(v) === norm(label)));
  return i;
};
const firstNumRight = (sheet, r, from = 1) => {
  const row = sheet.rows[r] || [];
  for (let c = from; c < row.length; c++) { const n = toNum(row[c]); if (n != null) return { v: n, c, f: sheet.formula(r, c) }; }
  return null;
};

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function makeGroups(rows) {
  const groups = [];
  let unit = null, cur = null;
  for (const r of rows) {
    if (oneLine(r.kind) || !unit) unit = { dept: oneLine(r.kind), workers: r.workers, people: r.people, row: r.row };
    const g = { hazards: [...r.hazards], method: r.method, samples: r.samples, unit, rows: [r.row], sheet: r.sheet, blank: r.blank, media: r.media ? [oneLine(r.media)] : [] };
    if (r.samples > 0) { cur = g; groups.push(g); }
    else if (cur && (cur.unit === unit || (r.blank && cur.blank)) && cur.method === r.method) { cur.hazards.push(...r.hazards); cur.rows.push(r.row); if (r.media) cur.media.push(oneLine(r.media)); }
    else { cur = g; groups.push(g); }
  }
  return groups;
}

export function parseHyundai(wb, opt = {}) {
  const sheets = readSheets(wb);
  const names = wb.SheetNames;
  const p = { warnings: [], names };
  p.mode = names.some((n) => n.includes('_연동헬퍼')) ? '수동' : names.some((n) => n.includes('소음제외')) ? '자동' : null;

  const gap = byName(sheets, '표준품셈');
  const labor = byName(sheets, '인건비');
  const direct = byName(sheets, '직접경비', '세부');
  const mat = byName(sheets, '재료비', '세부산출내역서') || byName(sheets, '분석재료비');
  const plan = byName(sheets, '계획서(사업장보고용)') || sheets.find((s) => s.name.includes('측정계획서') && !s.name.includes('붙여넣기'));
  const jaejip = byName(sheets, '재집');
  const master = sheets.find((s) => s.name === '유해인자') || byName(sheets, '유해인자목록');
  p.has = { gap: !!gap, labor: !!labor, direct: !!direct, mat: !!mat, plan: !!plan, jaejip: !!jaejip, master: !!master };

  // ── 갑지
  if (gap) {
    const title = gap.rows.flat().find((v) => typeof v === 'string' && /견적서/.test(v) && /(정기|수시)/.test(v));
    p.period = title ? (title.includes('수시') ? '수시' : '정기') : null;
    p.title = title;
    const pick = (lab) => { const r = labelRow(gap, lab); if (r < 0) return null; return { row: r + 1, v: null, f: gap.formula(r, 10), ...firstNumRight(gap, r) }; };
    p.gap = { labor: pick('직접인건비'), direct: pick('직접경비'), nego: pick('조정금액(NEGO)') };
    const r = gap.rows.findIndex((row) => (row || []).some((v) => typeof v === 'string' && norm(v) === '견적금액'));
    if (r >= 0) {
      const row = gap.rows[r];
      for (let c = 0; c < row.length; c++) {
        const f = gap.formula(r, c);
        if (f && /ROUNDDOWN/i.test(f)) { p.gap.total = { row: r + 1, v: toNum(row[c]), f, factor: Number((f.match(/\)\s*\*\s*([0-9.]+)/) || [])[1]) || null }; break; }
      }
    }
  }

  // ── 인건비: 방법별 집계 기준(SUMIF 조건 문자열)·노임단가
  if (labor) {
    p.labor = { measure: [], analysis: [], rates: [] };
    const r7 = labelRow(labor, '측정 대상 인원(인)');
    if (r7 >= 0) p.labor.persons = firstNumRight(labor, r7);
    labor.rows.forEach((row, r) => {
      const label = String(row?.[0] ?? '');
      const f = labor.formula(r, 17); // R열
      if (f && /SUMIFS?\(/i.test(f)) {
        const crit = (f.match(/"([^"]+)"/) || [])[1];
        const kind = /재료비|\$AN\$/.test(f) ? 'analysis' : 'measure';
        p.labor[kind].push({ row: r + 1, label, crit, v: toNum(row[17]), formula: true });
      }
      if (/^(특급|고급|중급|초급)기술자$/.test(label.trim())) p.labor.rates.push({ row: r + 1, grade: label.trim(), price: toNum(row[17]), isFormula: !!f });
      if (label.trim() === '계' && toNum(row[50]) != null && r > 55) p.labor.total = { row: r + 1, v: toNum(row[50]) };
    });
    if (!p.labor.total) { const r = labor.rows.findIndex((row, i) => i > 55 && String(row?.[0]).trim() === '계'); if (r >= 0) { const n = firstNumRight(labor, r); if (n) p.labor.total = { row: r + 1, v: n.v }; } }
  }
  if (direct) {
    const r = labelRow(direct, '직접경비 합계');
    p.direct = r >= 0 ? { row: r + 1, ...firstNumRight(direct, r) } : null;
    const below = (re) => { for (let r = 0; r < direct.rows.length; r++) { const c = (direct.rows[r] || []).findIndex((v) => typeof v === 'string' && re.test(v)); if (c >= 0) return toNum(direct.rows[r + 1]?.[c]); } return null; };
    p.travel = below(/^출장여비\(/); p.depreciation = below(/^감가상각비\(/);
    const r2 = labelRow(direct, '합계');
    p.directMat = r2 >= 0 ? { row: r2 + 1, ...firstNumRight(direct, r2) } : null;
  }

  // ── 마스터 명칭 / 단가표
  p.masterNames = new Set();
  if (master) {
    const h = findHeader(master.rows, { name: ['유해인자명'], out: ['출력명'], portal: ['포털'] }, 1);
    if (h) for (let r = h.row + 1; r < master.rows.length; r++) {
      for (const c of [h.cols.name, h.cols.out, h.cols.portal]) { const v = master.rows[r]?.[c]; if (v) { p.masterNames.add(norm(v)); p.masterNames.add(short(v)); } }
    }
  }
  p.priceTable = new Map();
  if (jaejip) {
    const h = findHeader(jaejip.rows, { name: ['유해인자'], measure: ['측정'], analysis: ['분석'] }, 2);
    if (h) for (let r = h.row + 1; r < jaejip.rows.length; r++) {
      const v = jaejip.rows[r]?.[h.cols.name]; if (v) { p.priceTable.set(norm(v), true); p.priceTable.set(short(v), true); }
    }
  }

  // ── 계획서 (수동: 두 번째 '구분' 열부터가 직접입력 블록)
  p.plan = []; p.planManual = [];
  if (plan) {
    const hdr = findHeader(plan.rows, PLAN, 3);
    if (!hdr) p.warnings.push(`'${plan.name}' 에서 계획서 헤더를 찾지 못했습니다.`);
    else {
      const kinds = (plan.rows[hdr.row] || []).map((v, c) => (norm(v) === '구분' ? c : -1)).filter((c) => c >= 0);
      const ranges = kinds.length > 1 ? [[kinds[0], kinds[1] - 1], [kinds[1], Infinity]] : [[0, Infinity]];
      const read = ([colMin, colMax]) => (readTable(plan, PLAN, { minHits: 3, colMin, colMax })?.items || []).filter((it) => String(it.hazard ?? '').trim()).map((it) => {
        const hazards = splitLines(it.hazard).map(baseName).filter(Boolean);
        return { ...it, hazards, multi: hazards.length > 1, samples: toNum(it.samples) ?? 0, people: toNum(it.people), workers: toNum(it.workers), method: String(it.method ?? '').trim(), blank: isBlankSample(it.hazard) || isBlankSample(it.kind) };
      });
      // 수동 양식: A~F = 직접입력(H~N)을 해석해 사업장에 나가는 값(수식), H~N = 직접 입력(텍스트). 검토는 사업장에 나가는 A~F 기준, H~N 과는 대조한다.
      if (ranges.length > 1) { p.planManual = read(ranges[1]); p.plan = read(ranges[0]); if (!p.plan.length) { p.plan = p.planManual; p.planManual = []; } }
      else p.plan = read(ranges[0]);
    }
  }

  p.siteName = (gap?.rows.slice(0, 14).map((r) => r?.[0]).find((v) => typeof v === 'string' && /건설|공사|현장/.test(v) && !/견적/.test(v))) || null;
  // 계획서 → 시료 그룹. 다성분은 첫 행에만 건수가 있고 이어지는 행(건수 빈칸·같은 방법)이 같은 시료로 묶인다.
  // 구분(공정)·근로자수·측정인원수는 단위작업 첫 행에만 있다.
  p.groups = makeGroups(p.plan);
  p.groupsManual = makeGroups(p.planManual);

  // ── 재료비내역서
  p.material = [];
  if (mat) {
    const t = readTable(mat, MAT, { minHits: 3 });
    if (!t) p.warnings.push(`'${mat.name}' 에서 재료비 헤더를 찾지 못했습니다.`);
    else {
      p.material = t.items.filter((it) => String(it.hazard ?? '').trim()).map((it) => ({ ...it, hazards: splitLines(it.hazard).map(baseName).filter(Boolean), count: toNum(it.count) ?? 0, mAmt: toNum(it.mAmt), aAmt: toNum(it.aAmt), amount: toNum(it.amount), blank: isBlankSample(it.kind) || isBlankSample(it.hazard), method: String(it.method ?? '').trim() }));
      p.matTotal = t.items.concat(t.totals).find((it) => norm(it.raw?.[0]) === '합계') || null;
    }
  }
  return p;
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const isPhysical = (row, crit) => row.method && crit.has(cn(row.method));

export function reviewHyundai(p, cfg, typeOverride) {
  const out = [];
  const co = cfg.companies.hyundai;
  p.warnings.forEach((w) => out.push(F('warn', '파싱', w)));
  const miss = Object.entries({ gap: '갑지(표준품셈 견적서)', labor: '인건비 세부산출내역서', direct: '직접경비 세부산출내역서', mat: '재료비 세부산출내역서', plan: '작업환경측정 계획서' }).filter(([k]) => !p.has[k]);
  miss.forEach(([, n]) => out.push(F('error', '구조', `'${n}' 시트를 찾지 못했습니다.`)));

  // 1) 견적 유형
  const type = typeOverride || (p.period && p.mode ? p.period + p.mode : null);
  if (!p.mode) out.push(F('warn', '유형', '자동/수동을 파일 구조로 판별하지 못했습니다(소음제외 붙여넣기 또는 _연동헬퍼 시트 없음).'));
  if (typeOverride && p.period && p.mode && typeOverride !== p.period + p.mode) out.push(F('error', '유형', `선택한 유형(${typeOverride})과 파일 내용(${p.period}${p.mode})이 다릅니다.`));
  const period = type ? type.slice(0, 2) : p.period;
  const mode = type ? type.slice(2) : p.mode;

  // 2) 갑지 / 인건비 / 직접경비 연결
  const g = p.gap || {};
  if (g.total) {
    const exp = co.rates[p.period || period]?.factor;
    if (exp != null && g.total.factor !== exp) out.push(F('error', 'NEGO 계수', `${p.period} 견적: 갑지 견적금액 계수 ×${g.total.factor} ≠ 기준 ×${exp}`, `갑지 ${g.total.row}행`));
    if (period && p.period && period !== p.period) out.push(F('error', '정기/수시', `선택/파일유형 ${period} 인데 갑지 제목은 '${p.period}' 입니다.`));
    if (g.labor && g.direct && g.nego) {
      const f100 = (x) => Math.floor(Math.round(x * 1e6) / 1e6 / 100) * 100;
      const after = /ROUNDDOWN\(\(K16\+K17\)\*[0-9.]+,-2\)\s*-\s*K18/i.test(g.total.f); // 수동 양식: 계수 적용·절사 뒤에 NEGO 차감
      const calc = after ? f100((g.labor.v + g.direct.v) * g.total.factor) - g.nego.v : f100((g.labor.v + g.direct.v - g.nego.v) * g.total.factor);
      if (g.total.v != null && calc !== g.total.v) out.push(F('error', '갑지', `견적금액 ${won(g.total.v)} ≠ 재계산 ${won(calc)} (${after ? '(인건비+경비)×' + g.total.factor + ' 백원 절사 − NEGO' : '(인건비+경비−NEGO)×' + g.total.factor + ' 백원 절사'})`, `갑지 ${g.total.row}행`));
      if (g.nego.v) out.push(F('warn', 'NEGO', `조정금액(NEGO) ${won(g.nego.v)}원이 입력되어 있습니다 — 의도한 조정인지 확인하세요.`, `갑지 ${g.nego.row}행`));
    }
  } else if (p.has.gap) out.push(F('warn', '갑지', '갑지 견적금액 수식(ROUNDDOWN)을 찾지 못했습니다.'));
  for (const [k, lab] of [['labor', '직접인건비'], ['direct', '직접경비']]) {
    if (g[k] && !g[k].f) out.push(F('error', '연동', `갑지 ${lab}이 수식이 아닌 직접 입력 값입니다 (${won(g[k].v)}). 세부내역서와 연동이 끊겼습니다.`, `갑지 ${g[k].row}행`));
  }
  if (g.labor && p.labor?.total && g.labor.v !== p.labor.total.v) out.push(F('error', '갑지↔인건비', `갑지 직접인건비 ${won(g.labor.v)} ≠ 인건비 세부내역 계 ${won(p.labor.total.v)}`));
  if (g.direct && p.direct && g.direct.v !== p.direct.v) out.push(F('error', '갑지↔직접경비', `갑지 직접경비 ${won(g.direct.v)} ≠ 직접경비 합계 ${won(p.direct.v)}`));

  // 3) 노임단가 (정기/수시 상이)
  const exp = co.rates[period]?.wage;
  if (p.labor?.rates.length) {
    if (!exp) out.push(F('info', '설정 필요', `${period} 노임단가 기준이 설정되지 않아 건너뜀`));
    else for (const r of p.labor.rates) if (exp[r.grade] != null && r.price !== exp[r.grade]) out.push(F('error', '노임단가', `${period} ${r.grade} 노임단가 ${won(r.price)} ≠ 기준 ${won(exp[r.grade])}`, `인건비 ${r.row}행`));
  }

  // 4) 방법명 ↔ 인건비 집계 조건(SUMIF) 일치: 공백·오타가 있으면 인건비 집계에서 빠진다
  //    계획서 측정방법 칸에는 물리인자는 측정기기명(소음노출량계…), 화학인자는 분석방법(AAS(다성분)…)이 들어간다
  const mCrit = new Set((p.labor?.measure || []).map((x) => cn(x.crit)));
  const aCrit = new Set((p.labor?.analysis || []).map((x) => cn(x.crit)));
  const planDup = new Set();
  if (p.labor) {
    for (const r of p.plan) {
      const m = cn(r.method);
      if (m && !mCrit.has(m) && !aCrit.has(m) && !/^(개인|지역)$/.test(r.method) && !planDup.has(`${r.row}`)) { planDup.add(`${r.row}`);
        out.push(F('error', '측정방법', `계획서 측정방법 '${r.method}' 이(가) 인건비 집계 항목에 없어 인건비에서 누락됩니다 (공백·오타 확인).`, `${r.sheet} ${r.row}행`)); }
    }
    for (const r of p.material) if (r.method && !aCrit.has(cn(r.method)))
      out.push(F('error', '분석방법', `재료비 분석방법 '${r.method}' 이(가) 인건비 집계 항목에 없어 인건비에서 누락됩니다.`, `${r.sheet} ${r.row}행`));
    // 물리 인자: 방법별 건수 = 인건비 R열
    for (const m of p.labor.measure) {
      const planN = sum(p.plan.filter((r) => cn(r.method) === cn(m.crit)), (r) => r.samples);
      if (m.v != null && planN !== m.v) out.push(F('error', '계획서↔인건비', `${m.crit}: 계획서 ${planN}건 / 인건비 ${m.v}건`, `인건비 ${m.row}행`));
    }
    const planPersons = sum(p.groups.filter((g) => g.unit.people != null).map((g) => g.unit).filter((u, i, a) => a.indexOf(u) === i), (u) => u.people);
    if (p.labor.persons && planPersons !== p.labor.persons.v) out.push(F('error', '계획서↔인건비', `측정인원수 합 ${planPersons} ≠ 인건비 '측정 대상 인원' ${p.labor.persons.v}`));
    // 분석 건수 = 재료비내역서 분석방법별 건수(공시료 포함)
    for (const a of p.labor.analysis) {
      const n = sum(p.material.filter((r) => cn(r.method) === cn(a.crit)), (r) => r.count);
      if (a.v != null && n !== a.v) out.push(F('error', '재료비↔인건비', `${a.crit}: 재료비내역서 ${n}건 / 인건비 ${a.v}건`, `인건비 ${a.row}행`));
    }
  }

  // 5) 계획서 ↔ 재료비내역서 (측정분, 화학인자). 물리인자는 재료비 산출표 제외, 공시료는 재료비산출표에서 수기 입력
  const physical = (g) => mCrit.has(cn(g.method));
  const chemGroups = p.groups.filter((g) => !physical(g) && !g.blank);
  const hz = (h) => key(h);
  const planMap = new Map(), nameOf = new Map(), planMethod = new Map();
  for (const g of chemGroups) for (const h of g.hazards) {
    planMap.set(hz(h), (planMap.get(hz(h)) || 0) + g.samples); nameOf.set(hz(h), h);
    if (g.method) planMethod.set(hz(h), g.method);
  }
  const matMeasure = p.material.filter((r) => !r.blank), matBlank = p.material.filter((r) => r.blank);
  const matMap = new Map();
  for (const r of matMeasure) for (const h of r.hazards) { matMap.set(hz(h), (matMap.get(hz(h)) || 0) + r.count); nameOf.set(hz(h), h); }
  // 표기만 다른 이름(예: 부틸아세테이트 ↔ n-부틸아세테이트)은 같은 인자로 보고 '표기 상이' 로 따로 알린다
  for (const k of [...planMap.keys()]) {
    if (matMap.has(k)) continue;
    const alt = [...matMap.keys()].find((m) => !planMap.has(m) && (m.includes(k) || k.includes(m)));
    if (alt) { out.push(F('warn', '명칭 표기', `계획서 '${nameOf.get(k)}' 와 재료비 '${nameOf.get(alt)}' 의 표기가 다릅니다 (같은 인자로 간주).`)); planMap.set(alt, planMap.get(k)); planMap.delete(k); planMethod.set(alt, planMethod.get(k)); }
  }
  for (const d of diffMaps(planMap, matMap)) out.push(F('error', '계획서↔재료비', `${nameOf.get(d.key) || d.key}: 계획서 ${d.a}건 / 재료비내역서(측정) ${d.b}건`, d.a > d.b ? '재료비 누락·과소' : '계획서 누락 또는 재료비 과다'));
  for (const r of matMeasure) for (const h of r.hazards) {
    const pm = planMethod.get(hz(h));
    if (pm && r.method && cn(pm) !== cn(r.method)) out.push(F('error', '분석방법', `${h}: 계획서 측정방법 '${pm}' / 재료비 분석방법 '${r.method}' 불일치`, `${r.sheet} ${r.row}행`));
  }

  // 6) 공시료: 측정된 모든 화학인자에 공시료가 있어야 하고, 측정하지 않은 인자의 공시료는 없어야 한다
  const blankSet = new Set(matBlank.flatMap((r) => r.hazards.map(hz)));
  const measuredSet = new Set([...planMap.keys(), ...matMap.keys()]);
  if (!matBlank.length) out.push(F('error', '공시료', '재료비내역서에 공시료 행이 없습니다.'));
  else {
    for (const k of measuredSet) if (!blankSet.has(k)) out.push(F('error', '공시료', `${nameOf.get(k)}: 측정은 있으나 공시료가 없습니다.`));
    for (const k of blankSet) if (!measuredSet.has(k)) out.push(F('error', '공시료', `${[...matBlank.flatMap((r) => r.hazards)].find((h) => hz(h) === k)}: 공시료만 있고 측정 건이 없습니다.`));
    // 분석방법별 공시료 존재
    for (const m of new Set(matMeasure.map((r) => cn(r.method)).filter(Boolean)))
      if (!matBlank.some((r) => cn(r.method) === m)) out.push(F('warn', '공시료', `분석방법 '${matMeasure.find((r) => cn(r.method) === m).method}' 측정분에 대한 공시료 행이 없습니다.`));
  }
  const planBlankGroups = p.groups.filter((g) => g.blank && g.samples > 0);
  if (planBlankGroups.length) {
    const pb = new Map(), mb = new Map();
    for (const g of planBlankGroups) for (const h of g.hazards) pb.set(hz(h), (pb.get(hz(h)) || 0) + g.samples);
    for (const r of matBlank) for (const h of r.hazards) mb.set(hz(h), (mb.get(hz(h)) || 0) + r.count);
    for (const d of diffMaps(pb, mb)) out.push(F('error', '공시료', `[공시료] ${nameOf.get(d.key) || d.key}: 계획서 공시료 ${d.a}건 / 재료비내역서 공시료 ${d.b}건`));
  }
  out.stats = { 유형: type, '계획서 시료건수': sum(p.groups, (g) => g.samples), '계획서 화학 시료건수': sum(chemGroups, (g) => g.samples), '재료비 측정건수': sum(matMeasure, (r) => r.count), '재료비 공시료건수': sum(matBlank, (r) => r.count), '재료비 합계(원)': sum(p.material, (r) => r.amount) };

  // 7) 인원수 대비 건수 (1~10인 2건, 이후 5인마다 +1건, 최대 20건 / 근로자가 더 적으면 근로자 수만큼)
  for (const u of [...new Set(p.groups.filter((g) => !g.blank).map((g) => g.unit))]) {
    if (u.workers == null) { out.push(F('warn', '인원', `[${u.dept}] 근로자수가 비어 있습니다.`, `계획서 ${u.row}행`)); continue; }
    const need = expectedSamples(u.workers);
    for (const g of p.groups.filter((g) => g.unit === u && !g.blank)) {
      if (g.samples !== need) out.push(F('error', '인원↔건수', `[${u.dept}] 근로자 ${u.workers}명 → ${need}건 필요, ${g.hazards.join('+')} ${g.samples}건`, `계획서 ${g.rows[0]}행`));
    }
    if (u.people != null && u.people !== need) out.push(F('warn', '인원↔건수', `[${u.dept}] 측정인원수 ${u.people} ≠ ${need}`, `계획서 ${u.row}행`));
  }

  // 8) 재료비 금액: 산식·0원·합계
  for (const r of p.material) {
    if (r.mAmt != null && r.aAmt != null && r.amount != null && r.mAmt + r.aAmt !== r.amount) out.push(F('error', '재료비 산식', `${r.hazards.join(' + ')}: 측정 ${won(r.mAmt)} + 분석 ${won(r.aAmt)} ≠ 합계 ${won(r.amount)}`, `${r.sheet} ${r.row}행`));
    if (r.count > 0 && r.amount === 0) out.push(F('error', '재료비 0원', `${r.blank ? '[공시료] ' : ''}${r.hazards.join(' + ')} ${r.count}건의 재료비가 0원입니다 (재료비산출표 단가 누락 가능).`, `${r.sheet} ${r.row}행`));
    if (r.f?.amount === false && r.amount != null && mode === '자동') out.push(F('warn', '연동', `${r.hazards.join(' + ')}: 합계가 수식이 아닌 직접 입력 값`, `${r.sheet} ${r.row}행`));
  }
  const matSum = sum(p.material, (r) => r.amount);
  const tot = p.matTotal ? toNum(p.matTotal.amount) : null;
  if (tot != null && tot !== matSum) out.push(F('error', '재료비 합계', `재료비 합계 ${won(tot)} ≠ 행 합 ${won(matSum)}`));
  if (p.directMat && tot != null && p.directMat.v !== tot) out.push(F('error', '재료비↔직접경비', `직접경비 재료비 ${won(p.directMat.v)} ≠ 재료비내역서 합계 ${won(tot)}`));

  // 9) 유해인자 명칭(마스터·단가표) / 단·다성분 일관성
  const known = (h) => p.masterNames.has(short(h)) || p.masterNames.has(norm(h)) || p.priceTable.has(short(h));
  if (p.masterNames.size) {
    const seen = new Set();
    for (const g of chemGroups) for (const h of g.hazards) if (!known(h) && !seen.has(norm(h))) { seen.add(norm(h)); out.push(F(mode === '수동' ? 'error' : 'warn', '유해인자 명칭', `계획서 '${h}' 가 유해인자 마스터 목록에 없습니다${mode === '수동' ? ' (텍스트 입력 오타 가능)' : ''}.`, `${g.sheet} ${g.rows[0]}행`)); }
    for (const r of p.material) for (const h of r.hazards) if (!known(h) && !seen.has(norm(h))) { seen.add(norm(h)); out.push(F('warn', '유해인자 명칭', `재료비 '${h}' 가 유해인자 마스터 목록에 없습니다.`, `${r.sheet} ${r.row}행`)); }
  }
  for (const r of p.material.filter((r) => !r.blank && r.method)) {
    if (/단성분/.test(r.method) && r.hazards.length > 1) out.push(F('error', '다성분', `${r.hazards.join(' + ')}: 여러 인자가 한 시료인데 분석방법이 '${r.method}' 입니다.`, `${r.sheet} ${r.row}행`));
  }
  for (const g of chemGroups) {
    if (/다성분/.test(g.method) && g.hazards.length < 2) out.push(F('warn', '다성분', `계획서 ${g.hazards[0]}: 분석방법 '${g.method}' 인데 단독 1개 인자입니다 (다성분 포집 기준 확인).`, `${g.sheet} ${g.rows[0]}행`));
    if (/단성분/.test(g.method) && g.hazards.length > 1) out.push(F('error', '다성분', `계획서 ${g.hazards.join(' + ')}: 한 시료로 묶였는데 분석방법이 '${g.method}' 입니다.`, `${g.sheet} ${g.rows[0]}행`));
  }
  // 수동: 자동 블록과 직접입력 블록 비교
  if (p.planManual.length) out.push(...reviewManualBlock(p));
  return out;
}

const mediaParts = (m) => String(m ?? '').split('/').map((x) => x.trim());

/** 수동 견적서: 직접 입력(H~N) ↔ 자동 해석(A~F) 대조, 매체/분석기기 기준 다성분 묶음 검증 */
function reviewManualBlock(p) {
  const out = [];
  const A = p.groups, B = p.groupsManual;
  const hz = (h) => norm(h);
  if (A.length !== B.length) out.push(F('error', '수동입력', `직접입력 블록 시료 그룹 ${B.length}개 ≠ 계획서(자동 해석) ${A.length}개 — 연동이 끊긴 행이 있을 수 있습니다.`));
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const a = A[i], b = B[i], where = `${b.sheet} ${b.rows[0]}행`;
    const bNames = b.media.length ? b.media.map((m) => hz(mediaParts(m)[0])) : b.hazards.map(hz);
    const aNames = a.hazards.map(hz);
    if (a.samples !== b.samples) out.push(F('error', '수동입력', `[${a.unit.dept}] ${b.hazards.join('+')}: 직접입력 ${b.samples}건 / 계획서 ${a.samples}건`, where));
    if (a.unit.workers !== b.unit.workers && b.unit.workers != null) out.push(F('error', '수동입력', `[${a.unit.dept}] 근로자수 직접입력 ${b.unit.workers} / 계획서 ${a.unit.workers}`, where));
    const miss = bNames.filter((x) => !aNames.some((y) => y === x || y.includes(x) || x.includes(y)));
    const extra = aNames.filter((y) => !bNames.some((x) => y === x || y.includes(x) || x.includes(y)));
    if (miss.length || extra.length) out.push(F('error', '수동입력', `[${a.unit.dept}] 직접입력 인자와 계획서 인자가 다릅니다 — 직접입력: ${b.hazards.join(', ')} / 계획서: ${a.hazards.join(', ')}`, where));
    // 입력 칸(I)과 종류선택(J) 이름이 서로 다르면 텍스트 오기
    b.hazards.forEach((h, k) => { const m = b.media[k]; if (m && !norm(mediaParts(m)[0]).includes(norm(h)) && !norm(h).includes(norm(mediaParts(m)[0]))) out.push(F('warn', '수동입력', `'${h}' 입력과 종류선택 '${m}' 의 물질명이 다릅니다.`, where)); });
    if (a.method && b.method && !norm(a.method).startsWith(norm(b.method.replace(/\(.*$/, '')))) out.push(F('error', '수동입력', `[${a.unit.dept}] 측정방법 직접입력 '${b.method}' / 계획서 '${a.method}' 불일치`, where));
  }
  // 다성분: 한 시료로 묶인 인자는 매체·분석기기가 같아야 한다 (종류선택 '물질 / 매체 / 기기')
  for (const g of B) {
    if (g.hazards.length < 2 || g.media.length < 2) continue;
    const keys = new Set(g.media.map((m) => mediaParts(m).slice(1, 3).map(norm).join('/')));
    if (keys.size > 1) out.push(F('error', '다성분', `동시포집 기준 위반: ${g.hazards.join(' + ')} — 매체/분석기기가 서로 다릅니다 (${[...keys].join(' | ')}).`, `${g.sheet} ${g.rows[0]}행`));
  }
  // 같은 매체·기기인데 따로 분리된 단일 시료(같은 단위작업) → 다성분 병합 누락 의심
  const byUnit = new Map();
  for (const g of B.filter((g) => g.hazards.length === 1 && g.media.length === 1 && g.samples > 0 && !/물리/.test(g.media[0]))) {
    const k = `${g.unit.dept}|${mediaParts(g.media[0]).slice(1, 3).join('/')}`;
    byUnit.set(k, [...(byUnit.get(k) || []), g]);
  }
  for (const [k, gs] of byUnit) if (gs.length > 1 && !/^중량|여과/.test(mediaParts(gs[0].media[0])[1] || ''))
    out.push(F('warn', '다성분', `[${gs[0].unit.dept}] 같은 매체·기기(${k.split('|')[1]})인 ${gs.map((g) => g.hazards[0]).join(', ')} 가 각각 별도 시료로 입력됨 — 다성분 병합 가능 여부 확인(분석비 과다 가능).`, gs.map((g) => `${g.rows[0]}행`).join(',')));
  return out;
}

/** 사업장 제출용 엑셀(실시현황 + 계획서 + 재료비) 파서 */
export function parseSubmission(wb) {
  const p = parseHyundai(wb);
  const sheets = readSheets(wb);
  const st = sheets.find((s) => s.name.includes('실시현황'));
  p.status = null;
  if (st) {
    const rows = st.rows;
    const rr = rows.findIndex((r) => (r || []).some((v) => typeof v === 'string' && norm(v).includes('최종수수료')));
    if (rr >= 0) {
      const col = (re, from, to) => { for (let r = from; r <= to; r++) { const c = (rows[r] || []).findIndex((v) => typeof v === 'string' && re.test(norm(v))); if (c >= 0) return { r, c }; } return null; };
      const fee = col(/최종수수료/, rr, rr), travel = col(/출장여비/, rr, rr + 2), dep = col(/감가상각비/, rr, rr + 2), mat = col(/^재료비/, rr, rr + 2), kind = col(/^구분$/, rr, rr + 1), ppl = col(/총근로자수/, rr, rr + 1), site = col(/현장명/, rr, rr + 1);
      const dr = Math.max(...[travel, dep, mat].filter(Boolean).map((x) => x.r)) + 1;
      const at = (x) => (x ? rows[dr]?.[x.c] : null);
      p.status = { row: dr + 1, fee: toNum(at(fee)), travel: toNum(at(travel)), dep: toNum(at(dep)), mat: toNum(at(mat)), kind: String(at(kind) ?? '').trim(), people: toNum(at(ppl)), site: String(at(site) ?? '') };
    }
  }
  return p;
}

const sig = (g) => `${g.unit.dept}|${g.hazards.join('+')}|${g.method}|${g.samples}|${g.unit.workers ?? ''}|${g.unit.people ?? ''}`;
const msig = (r) => `${r.blank ? '공시료' : '측정'}|${r.hazards.join('+')}|${r.count}|${r.method}|${r.mAmt}|${r.aAmt}|${r.amount}`;
const sitekey = (s) => norm(String(s ?? '').replace(/\[[^\]]*\]/g, ''));

/** 사업장 제출용 엑셀 ↔ 견적서(xlsm) 일치 검토 */
export function reviewSubmission(sub, est) {
  const out = [];
  const st = sub.status;
  if (!st) out.push(F('info', '실시현황', "제출용 파일에 '실시현황' 시트가 없어 수수료·현장명 대조는 건너뜁니다."));
  else {
    const fee = est.gap?.total?.v;
    const where = `실시현황 ${st.row}행`;
    if (fee != null && st.fee !== fee) out.push(F('error', '실시현황↔견적', `최종수수료 ${won(st.fee)} ≠ 견적금액 ${won(fee)}`, where));
    if (est.travel != null && st.travel !== est.travel) out.push(F('error', '실시현황↔견적', `출장여비 ${won(st.travel)} ≠ 견적서 ${won(est.travel)}`, where));
    if (est.depreciation != null && st.dep !== Math.round(est.depreciation)) out.push(F('error', '실시현황↔견적', `감가상각비 ${won(st.dep)} ≠ 견적서 ${won(Math.round(est.depreciation))}`, where));
    const matTotal = est.matTotal ? toNum(est.matTotal.amount) : null;
    if (matTotal != null && st.mat !== matTotal) out.push(F('error', '실시현황↔견적', `재료비 ${won(st.mat)} ≠ 견적서 재료비 합계 ${won(matTotal)}${st.mat === est.direct?.v ? ' (직접경비 합계가 입력된 것으로 보임)' : ''}`, where));
    if (est.period && st.kind && !st.kind.includes(est.period)) out.push(F('error', '실시현황↔견적', `구분 '${st.kind}' ≠ 견적 유형 '${est.period}'`, where));
    if (est.labor?.persons && st.people != null && st.people !== est.labor.persons.v) out.push(F('warn', '실시현황↔견적', `총 근로자 수 ${st.people} ≠ 인건비 측정 대상 인원 ${est.labor.persons.v}`, where));
    if (est.siteName && st.site && !sitekey(st.site).includes(sitekey(est.siteName)) && !sitekey(est.siteName).includes(sitekey(st.site))) out.push(F('error', '현장명', `현장명 불일치: 견적서 '${est.siteName}' / 실시현황 '${st.site}'`, where));
  }
  const a = new Map(), b = new Map();
  // 제출용 계획서에는 공시료 행이 붙어 있고(견적서 계획서에는 없음) → 측정 그룹만 비교하고, 공시료는 재료비 공시료 행과 따로 대조
  est.groups.filter((g) => !g.blank).forEach((g) => a.set(sig(g), (a.get(sig(g)) || 0) + 1));
  sub.groups.filter((g) => !g.blank).forEach((g) => b.set(sig(g), (b.get(sig(g)) || 0) + 1));
  const bl = new Map(), bm = new Map();
  for (const g of sub.groups.filter((g) => g.blank)) for (const h of g.hazards) bl.set(key(h), (bl.get(key(h)) || 0) + g.samples);
  for (const r of est.material.filter((r) => r.blank)) for (const h of r.hazards) bm.set(key(h), (bm.get(key(h)) || 0) + r.count);
  for (const d of diffMaps(bm, bl)) out.push(F('error', '공시료', `공시료 ${d.key}: 재료비내역서 ${d.a}건 / 제출용 계획서 ${d.b}건`));
  for (const d of diffMaps(a, b)) out.push(F('error', '계획서 불일치', `${d.a ? '견적서에만' : '제출용에만'} 있는 행: ${d.key.replaceAll('|', ' | ')}`));
  const ma = new Map(), mb = new Map();
  est.material.forEach((r) => ma.set(msig(r), (ma.get(msig(r)) || 0) + 1));
  sub.material.forEach((r) => mb.set(msig(r), (mb.get(msig(r)) || 0) + 1));
  for (const d of diffMaps(ma, mb)) out.push(F('error', '재료비 불일치', `${d.a ? '견적서에만' : '제출용에만'} 있는 행: ${d.key.replaceAll('|', ' | ')}`));
  if (!out.length) out.push(F('info', '제출용', '제출용 엑셀이 견적서와 일치합니다.'));
  return out;
}
