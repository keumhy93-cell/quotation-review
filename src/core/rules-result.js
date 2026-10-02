import { finding as F, norm, normHazard, expectedSamples, diffMaps, canonHazard } from './util.js';
import { pdfRows } from './result-pdf.js';

const FREQ_RE = /(\d+\s*(회|시간|분|일|주|월|번))|((일|주|월|연)\s*\d+)/;
const set = (xs) => new Set(xs.map(normHazard));
const where = (r) => `${r.sheet} ${r.row}행`;

/** 결과서 단독 검토 */
export function reviewResult(res, cfg) {
  const out = [];
  res.warnings.forEach((w) => out.push(F('warn', '파싱', w, res.file)));

  // 1) 유해인자 vs 사용실태 비고
  for (const r of res.rows) {
    if (!r.usageHazards.length) continue;
    const m = set(r.hazards), u = set(r.usageHazards);
    const missing = r.usageHazards.filter((h) => !m.has(normHazard(h)));
    const extra = r.hazards.filter((h) => !u.has(normHazard(h)));
    if (missing.length) out.push(F('error', '측정 누락', `[${r.dept} ${r.work}] 사용실태 비고에는 있으나 측정되지 않음: ${missing.join(', ')}`, where(r)));
    if (extra.length) out.push(F('warn', '과다 측정', `[${r.dept} ${r.work}] 측정했으나 사용실태 비고에 없음: ${extra.join(', ')}`, where(r)));
  }

  // 2) 임시·단시간 허용소비량
  for (const r of res.rows.filter((r) => r.tempChecked)) {
    const dist = String(r.dist ?? '');
    if (!/임시|단시간|허용소비량/.test(dist)) out.push(F('error', '임시·단시간', `[${r.dept} ${r.work}] 임시·단시간 허용소비량 체크됨 — 분포실태에 해당 내용이 없습니다.`, where(r)));
    if (!FREQ_RE.test(String(r.note ?? '') + String(r.usage ?? ''))) out.push(F('error', '임시·단시간', `[${r.dept} ${r.work}] 비고에 사용빈도(예: 월 2회, 1회 30분)가 구체적으로 적혀 있지 않습니다.`, where(r)));
  }

  // 3) 인원수 대비 측정 건수 (단위작업·유해인자별)
  const groups = new Map();
  for (const r of res.rows) {
    if (r.persons == null || !r.hazards.length) continue;
    const k = `${r.dept}|${r.work}|${[...set(r.hazards)].sort().join('+')}`;
    const g = groups.get(k) || { persons: r.persons, n: 0, r };
    g.n++; groups.set(k, g);
  }
  for (const g of groups.values()) {
    const need = expectedSamples(g.persons);
    if (g.persons > 100) out.push(F('info', '측정건수', `[${g.r.dept} ${g.r.work}] 인원 ${g.persons}명 — 100명 초과분은 측정하지 않으므로 최대 20건 기준`, where(g.r)));
    if (g.n < need) out.push(F('error', '측정건수', `[${g.r.dept} ${g.r.work}] ${g.r.hazards.join('+')}: 인원 ${g.persons}명 → ${need}건 필요, 실제 ${g.n}건 (부족)`, where(g.r)));
    else if (g.n > need) out.push(F('warn', '측정건수', `[${g.r.dept} ${g.r.work}] ${g.r.hazards.join('+')}: 인원 ${g.persons}명 → ${need}건 기준, 실제 ${g.n}건 (과다)`, where(g.r)));
  }

  // 4) 갑지 전회 — 건설업은 '전회 없음'
  if (cfg.industry === '건설업' && res.cover.consecutiveLessChecked)
    out.push(F('error', '갑지', '건설업은 전회 측정이 없으므로 "2회 연속 미만"에 체크할 수 없습니다.', res.cover.consecutiveLess || ''));
  else if (cfg.industry === '건설업' && res.cover.consecutiveLess && !res.cover.consecutiveLessChecked)
    out.push(F('info', '갑지', '"2회 연속 미만" 항목은 있으나 체크 표시를 인식하지 못했습니다. 육안 확인 권장.'));

  // 5) 초과
  for (const r of res.rows) {
    const over = r.exceedFlag || (r.value != null && r.limit != null && r.value > r.limit);
    if (over) out.push(F('warn', '초과', `[${r.dept} ${r.work}] ${r.hazards.join(', ')} 노출기준 초과 (측정 ${r.value ?? '-'} / 기준 ${r.limit ?? '-'})`, where(r)));
  }
  out.stats = { rows: res.rows.length };
  return out;
}

/** 결과서 간 비교 (여러 결과서를 올렸을 때) */
export function reviewResultSet(results) {
  const out = [];
  if (results.length < 2) return out;
  const pdfs = results.filter((r) => r.kind === 'pdf');
  if (pdfs.length > 1) {
    const bySite = new Map();
    for (const r of pdfs) { const k = norm(String(r.cover.site ?? '').replace(/[㈜()（）]|\(주\)/g, '').replace(/^.*?[-－]/, '')); bySite.set(k, [...(bySite.get(k) || []), r]); }
    for (const [k, rs] of bySite) if (k && rs.length > 1) {
      out.push(F('warn', '결과서 간', `같은 현장 결과서가 ${rs.length}개 입니다: ${rs.map((r) => r.file).join(', ')}`));
      const cos = [...new Set(rs.map((r) => String(r.cover.site).replace(/\s*[-－].*$/, '').replace(/\s+/g, '')))];
      if (cos.length > 1) out.push(F('error', '결과서 간', `같은 현장인데 상호 표기가 다릅니다: ${cos.join(' / ')}`));
      const per = [...new Set(rs.map((r) => r.cover.period))];
      if (per.length === 1) out.push(F('warn', '결과서 간', `같은 현장에 ${per[0]} 결과서가 중복되어 있습니다.`));
    }
    const periods = [...new Set(pdfs.map((r) => r.cover.date?.slice(0, 5)))];
    if (periods.length > 1) out.push(F('info', '결과서 간', `측정 연도가 다른 결과서가 섞여 있습니다: ${periods.join(', ')}`));
  }
  const sites = [...new Set(results.map((r) => r.cover.site).filter(Boolean))];
  if (sites.length > 1) out.push(F('error', '결과서 간', `사업장명이 서로 다름: ${sites.join(' / ')}`));
  const seen = new Map(), limits = new Map();
  for (const res of results) for (const r of res.rows) {
    for (const h of r.hazards) {
      const k = `${r.dept}|${r.work}|${normHazard(h)}`;
      if (seen.has(k) && seen.get(k) !== res.file) out.push(F('warn', '결과서 간', `[${r.dept} ${r.work}] ${h} 가 ${seen.get(k)} 와 ${res.file} 에 중복 측정됨`));
      seen.set(k, res.file);
      if (r.limit != null) {
        const lk = normHazard(h), prev = limits.get(lk);
        if (prev && prev.v !== r.limit) out.push(F('error', '결과서 간', `${h} 노출기준 불일치: ${prev.f} ${prev.v} / ${res.file} ${r.limit}`));
        else if (!prev) limits.set(lk, { v: r.limit, f: res.file });
      }
    }
  }
  return out;
}

/** 결과서 ↔ 견적서: 유해인자 조합(한 시료로 묶인 인자 세트)과 건수. est 는 groups(또는 plan/material) 형태 */
export function compareResultToEstimate(resList, est, aliases = {}) {
  const out = [];
  const combo = (hs) => [...new Set(hs.map((h) => canonHazard(h, aliases)))].sort().join(' + ');
  const resCombos = new Map();
  for (const res of resList) for (const r of res.kind === 'pdf' ? pdfRows(res) : res.rows) {
    if (!r.hazards.length) continue;
    const k = combo(r.hazards); resCombos.set(k, (resCombos.get(k) || 0) + 1);
  }
  const estCombos = new Map();
  const add = (hs, n) => { const k = combo(hs); estCombos.set(k, (estCombos.get(k) || 0) + n); };
  if (est.groups?.length) for (const g of est.groups.filter((g) => !g.blank && g.samples > 0)) add(g.hazards, g.samples);
  else if (est.plan?.length) for (const p of est.plan.filter((p) => !p.blank)) add(p.hazards, p.samples);
  else for (const m of (est.material || []).filter((m) => !m.blank && !/기본관리|관리인원/.test(m.hazard))) add([m.hazard], m.count);

  const show = (k) => k; 
  for (const d of diffMaps(estCombos, resCombos)) out.push(F('error', '결과서↔견적서', `조합 [${show(d.key)}]: 견적서 ${d.a}건 / 결과서 ${d.b}건`, d.a > d.b ? '견적 과다(결과서 누락)' : '견적 부족(결과서에만 있음)'));
  const ta = [...estCombos.values()].reduce((a, b) => a + b, 0), tb = [...resCombos.values()].reduce((a, b) => a + b, 0);
  out.push(F(ta === tb ? 'info' : 'error', '결과서↔견적서', `총 측정건수: 견적서 ${ta} / 결과서 ${tb}${ta === tb ? ' (일치)' : ''}`));
  return out;
}
