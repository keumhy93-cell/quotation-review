/**
 * 결과서(PDF) 텍스트 파서 + 검토.
 * 입력은 PDF 에서 뽑은 텍스트(줄바꿈 유지). Node 는 `pdftotext -layout`, 브라우저는 pdf.js 로 만든다(web/pdf-text.js).
 * 대상 양식: 산업안전보건법 시행규칙 별지 제82호(결과보고서)·제83호(결과표) + 협회 종합의견 서식.
 */
import { finding as F, norm, expectedSamples, splitLines, canonHazard } from './util.js';

const TIME_RE = /\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/;
const FREQ_RE = /(\d+\s*(회|시간|분|일|주|월|번))|((일|주|월|연)\s*\d+)/;
const CHECK = '[√✓✔vV■●]';
const section = (lines, from, to) => {
  const a = lines.findIndex((l) => from.test(l));
  if (a < 0) return [];
  let b = lines.findIndex((l, i) => i > a && to.test(l));
  if (b < 0) b = lines.length;
  return lines.slice(a + 1, b);
};
const clean = (l) => l.replace(/\f/g, '');

export function parseResultText(text, file = '') {
  const lines = String(text).split(/\r?\n/).map(clean);
  const full = lines.join('\n');
  const r = { file, kind: 'pdf', warnings: [], cover: {}, summary: [], plan: [], distribution: [], samples: [], opinion: [] };

  // ── 표지·별지82
  r.cover.site = (full.match(/사업장명[ \t]+(.+?)[ \t]+대표자/) || full.match(/사업장명[ \t]+(\S.*)$/m) || [])[1]?.trim();
  r.cover.workers = Number((full.match(/근로자\s*수\s+(\d+)/) || [])[1]) || null;
  r.cover.industry = (full.match(/업종\s+(.+?)\s*$/m) || [])[1]?.trim();
  r.cover.period = new RegExp(`\\[\\s*${CHECK}\\s*\\]\\s*정기`).test(full) ? '정기' : new RegExp(`\\[\\s*${CHECK}\\s*\\]\\s*수시`).test(full) ? '수시' : null;
  r.cover.date = (full.match(/측정기간\s*:\s*(\d{4}년\s*\d+월\s*\d+일)/) || full.match(/측정일\s*:\s*(\d{4}년\s*\d+월\s*\d+일)/) || [])[1];
  r.cover.consecutiveLessChecked = new RegExp(`\\[\\s*${CHECK}\\s*\\]\\s*2회\\s*연속\\s*미만`).test(full);
  r.cover.consecutiveOverChecked = new RegExp(`\\[\\s*${CHECK}\\s*\\]\\s*2회\\s*연속\\s*초과`).test(full);
  r.cover.prevMeasured = (full.match(/전회\s*측정일\s*:\s*(\S+(?: \S+)?)/) || [])[1];

  // ── 별표: 측정결과 요약
  for (const l of section(lines, /별지\s*제82호서식\s*측정결과/, /별지\s*제83호서식\]?\s*$|\[별지\s*제83호서식\]/)) {
    const m = l.trim().match(/^(\S.*?)\s+(\d+)\s+(불검출|검출한계\s*미만|[\d.,]+\s*\S*)\s+(\d+)\s*$/);
    if (m && !/유해인자명/.test(l)) r.summary.push({ hazard: m[1].trim(), processes: Number(m[2]), max: m[3].replace(/\s+/g, ' '), exceed: Number(m[4]) });
  }
  const known = [...new Set(r.summary.map((s) => s.hazard))];

  // ── 측정계획: 부서 / 유해인자 / 근로자수 / 건수
  const planLines = section(lines, /나\.\s*작업환경측정\s*공정별/, /다\.\s*공정별\s*화학물질/);
  let dept = null, wk = null;
  for (const raw of planLines) {
    const l = raw.trim();
    if (!l || /측정대상|유해|예상시료|발생|주기|\(폭로|채취건수|측정건수|^수\s|^인자|^또는|근로자|개인\/지역|작업시간/.test(l) && !/<|개인|지역/.test(l)) continue;
    if (/작업환경측정에\s*걸리는/.test(l)) continue;
    const cat = l.match(/^(.*?)\s*<\s*(\S+)\s*>\s*$/);
    if (cat) { if (cat[1].trim()) { dept = cat[1].trim(); wk = null; } continue; }
    let m = l.match(/^(.+?)\s+(?:(불규칙|연속|\S*주기\S*|\S+)\s+)?(\d+)\s+(\d+(?:\.\d+)?)\s*\(\s*\d+(?:\.\d+)?\s*\)\s+(개인|지역)\s+(\d+)\s*$/);
    if (m) { wk = Number(m[3]); r.plan.push({ dept, hazard: m[1].trim(), workers: wk, method: m[5], count: Number(m[6]) }); continue; }
    m = l.match(/^(.+?)\s+(개인|지역)\s+(\d+)\s*$/);
    if (m) r.plan.push({ dept, hazard: m[1].trim(), workers: wk, method: m[2], count: Number(m[3]) });
  }
  const depts = [...new Set(r.plan.map((p) => p.dept).filter(Boolean))];
  const hazardSet = new Set([...known, ...r.plan.map((p) => p.hazard)]);
  const hazList = [...hazardSet].sort((a, b) => b.length - a.length);

  // ── 공정별 유해요인 분포 실태
  const dist = section(lines, /가\.\s*작업공정별\s*유해요인\s*분포/, /사업장\s*보건정보|2\)\s*근무시간|1\)\s*각\s*공정/);
  for (let i = 0; i < dist.length; i++) {
    if (!/유해요인\s*:/.test(dist[i])) continue;
    let hz = dist[i].replace(/.*유해요인\s*:\s*/, '');
    let j = i + 1;
    while (j < dist.length && !/근로자수\s*:/.test(dist[j]) && j < i + 5) { hz += ' ' + dist[j].trim(); j++; }
    const wkm = (dist[j] || '').match(/근로자수\s*:\s*(\d+)/);
    let k = j + 1; const body = [];
    while (k < dist.length && !/유해요인\s*:/.test(dist[k]) && !/^※/.test(dist[k])) { body.push(dist[k].trim()); k++; }
    // 이전 줄 중 부서명(⊙ 로 시작하지 않는 짧은 줄)
    let label = ''; for (let b = i - 1; b >= 0 && b > i - 4; b--) { const t = dist[b].trim(); if (t && !/[⊙○]/.test(t)) { label = t; break; } }
    // 줄바꿈 때문에 유해요인 사이에 부서명이 끼어들 수 있어 부서명을 먼저 제거하고, 괄호 밖 쉼표로 나눈다
    for (const d of [...depts].sort((a, b) => b.length - a.length)) hz = hz.split(d).join(' ');
    const knownByNorm = new Map(hazList.map((h) => [norm(h), h]));
    const hazards = hz.split(/,(?![^()]*\))/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).map((x) => knownByNorm.get(norm(x)) || x);
    r.distribution.push({ label, hazards, workers: wkm ? Number(wkm[1]) : null, text: body.filter((x) => !/유해인자\s*분포실태/.test(x)).join(' ') });
  }
  r.distributionText = dist.join('\n');

  // ── 화학물질 사용 상태
  r.chemUse = section(lines, /다\.\s*공정별\s*화학물질\s*사용/, /나-1\.|단위작업\s*장소별/).join('\n');
  r.chemUseNone = /해당\s*사항\s*없음/.test(r.chemUse);
  // 부서 단위로 사용실태 행 묶기 (부서명으로 시작하는 줄이 새 묶음)
  r.chemUseByDept = new Map();
  { let d = null; for (const l of r.chemUse.split('\n')) { const t = l.trim(); if (!t || /부서\s*또는|화학물질명|제조|또는|사용\s*용도|여부|월\s*취급량|\(단위\)/.test(t) && !depts.some((x) => t.startsWith(x))) continue;
    const hit = depts.filter((x) => t.startsWith(x)).sort((a, b) => b.length - a.length)[0]; if (hit) d = hit;
    if (d) r.chemUseByDept.set(d, (r.chemUseByDept.get(d) || '') + ' ' + t); } }

  // ── 결과표(나-1: 소음 제외) → 시료(측정위치) 단위 유해인자 조합. 시간대가 있는 줄이 새 시료, 없으면 앞 시료에 이어진 인자
  const res1 = section(lines, /나-1\.\s*단위작업/, /나-2\.\s*단위작업|3\.\s*측정\s*결과에\s*따른/);
  let curDept = null, cur = null;
  const findHaz = (l) => { let best = null; for (const h of hazList) { const i = l.indexOf(h); if (i >= 0 && (!best || i < best.i)) best = { h, i }; } return best; };
  for (const l of res1) {
    const t = l.trim();
    const d = depts.filter((x) => t.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    if (d) curDept = d;
    const hz = findHaz(l);
    if (!hz || hz.h === '소음') continue;
    const time = (l.match(TIME_RE) || [])[0];
    const person = (l.match(/\d+\)\s*([가-힣A-Za-z]+)/) || [])[1];
    if (time || !cur) { cur = { dept: curDept, hazards: [hz.h], time, person: person || cur?.person, noise: false }; r.samples.push(cur); }
    else cur.hazards.push(hz.h);
  }
  // ── 소음(나-2): 측정위치(시간) 한 줄이 1건
  const res2 = section(lines, /나-2\.\s*단위작업/, /3\.\s*측정\s*결과에\s*따른/);
  curDept = null;
  for (const l of res2) {
    const t = l.trim();
    const d = depts.filter((x) => t.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    if (d) curDept = d;
    if (TIME_RE.test(l) && /\d+\)\s*\S+/.test(l)) r.samples.push({ dept: curDept, hazards: ['소음'], time: (l.match(TIME_RE) || [])[0], person: (l.match(/\d+\)\s*([가-힣A-Za-z]+)/) || [])[1], noise: true, exceed: /초과/.test(l) });
  }

  // ── 종합의견 표: 초과 평가
  const op = section(lines, /3\.\s*측정\s*결과에\s*따른/, /검출한계\s*및\s*정량한계/);
  for (const l of op) {
    const hz = findHaz(l);
    if (hz && /초과/.test(l)) r.opinion.push({ hazard: hz.h, exceed: true, line: l.trim() });
  }
  if (!r.plan.length) r.warnings.push('결과서에서 "공정별 및 유해인자별 측정계획" 표를 찾지 못했습니다(양식 확인).');
  if (!r.samples.length) r.warnings.push('결과표(나-1/나-2)에서 시료를 읽지 못했습니다.');
  return r;
}

const setOf = (xs) => new Set(xs.map(norm));

export function reviewResultPdf(res, cfg) {
  const aliases = cfg.hazardAliases || {};
  const out = [];
  res.warnings.forEach((w) => out.push(F('warn', '파싱', w, res.file)));
  const c = res.cover;

  // 1) 갑지(별지82) 전회 — 건설업은 전회 없음이므로 '2회 연속 미만' 불가
  const construction = cfg.industry === '건설업' || /건설/.test(c.industry || '');
  if (construction && c.consecutiveLessChecked) out.push(F('error', '갑지', '건설업은 전회 측정이 없으므로 "2회 연속 미만"에 체크할 수 없습니다.'));
  if (construction && c.consecutiveOverChecked) out.push(F('error', '갑지', '건설업은 전회 측정이 없으므로 "2회 연속 초과"에 체크할 수 없습니다.'));

  // 2) 인원수 ↔ 측정건수 (부서·유해인자)
  const byDept = new Map();
  for (const p of res.plan) { const a = byDept.get(p.dept) || { workers: p.workers, rows: [] }; a.rows.push(p); if (p.workers != null) a.workers = p.workers; byDept.set(p.dept, a); }
  for (const [dept, a] of byDept) {
    if (a.workers == null) continue;
    const need = expectedSamples(a.workers);
    for (const p of a.rows) if (p.count !== need) out.push(F('error', '인원↔건수', `[${dept}] ${p.hazard}: 근로자 ${a.workers}명 → ${need}건, 측정계획 ${p.count}건`));
  }
  const sumWorkers = [...byDept.values()].reduce((s, a) => s + (a.workers || 0), 0);
  if (c.workers != null && byDept.size && sumWorkers !== c.workers) out.push(F('error', '근로자수', `부서별 근로자수 합 ${sumWorkers}명 ≠ 사업장 근로자 수 ${c.workers}명`));

  // 3) 결과표 시료 수 ↔ 측정계획 건수 (부서·유해인자)
  const got = new Map();
  for (const s of res.samples) for (const h of new Set(s.hazards)) { const k = `${s.dept}|${norm(h)}`; got.set(k, (got.get(k) || 0) + 1); }
  for (const p of res.plan) {
    const g = got.get(`${p.dept}|${norm(p.hazard)}`) || 0;
    if (g !== p.count) out.push(F('error', g < p.count ? '측정 누락' : '과다 측정', `[${p.dept}] ${p.hazard}: 측정계획 ${p.count}건 / 결과표 ${g}건`));
  }
  const planKeys = new Set(res.plan.map((p) => `${p.dept}|${norm(p.hazard)}`));
  for (const [k, g] of got) if (!planKeys.has(k)) out.push(F('error', '과다 측정', `[${k.split('|')[0]}] ${k.split('|')[1]}: 측정계획에 없는데 결과표에 ${g}건 있음`));

  // 4) 별표 요약 ↔ 측정계획
  for (const s of res.summary) {
    const n = new Set(res.plan.filter((p) => norm(p.hazard) === norm(s.hazard)).map((p) => p.dept)).size;
    if (res.plan.length && n !== s.processes) out.push(F('error', '측정결과 요약', `${s.hazard}: 요약 공정수 ${s.processes} ≠ 측정계획 공정수 ${n}`));
    if (s.exceed > 0) out.push(F('warn', '초과', `${s.hazard}: 노출기준 초과 공정 ${s.exceed}개 (최고치 ${s.max})`));
  }
  const sumSet = setOf(res.summary.map((s) => s.hazard));
  for (const p of res.plan) if (res.summary.length && !sumSet.has(norm(p.hazard))) out.push(F('error', '측정결과 요약', `${p.hazard}: 측정계획에는 있으나 별표 측정결과 요약에 없음`));
  for (const o of res.opinion) out.push(F('warn', '초과', `종합의견 표에서 초과 평가: ${o.line.replace(/\s+/g, ' ')}`));
  for (const s of res.samples.filter((s) => s.exceed)) out.push(F('warn', '초과', `[${s.dept}] 소음 ${s.person || ''} 노출기준 초과`));

  // 5) 분포실태 ↔ 측정계획 (부서별 유해인자 누락/과다)
  const used = new Set();
  for (const d of res.distribution) {
    const cand = [...byDept].filter(([dept, a]) => !used.has(dept) && (d.workers == null || a.workers === d.workers));
    if (!cand.length) continue;
    const score = (a) => { const s = setOf(a.rows.map((x) => x.hazard)); return d.hazards.filter((h) => s.has(norm(h))).length; };
    const [dept, a] = cand.sort((x, y) => score(y[1]) - score(x[1]))[0];
    used.add(dept);
    const ps = setOf(a.rows.map((x) => x.hazard)), ds = setOf(d.hazards);
    const miss = a.rows.map((x) => x.hazard).filter((h, i, arr) => arr.indexOf(h) === i && !ds.has(norm(h)));
    const extra = d.hazards.filter((h) => !ps.has(norm(h)));
    if (miss.length) out.push(F('error', '측정 누락', `[${dept}] 측정계획에는 있으나 분포실태 유해요인에 없음: ${miss.join(', ')}`));
    if (extra.length) out.push(F('error', '과다/누락', `[${dept}] 분포실태 유해요인에 있으나 측정하지 않음: ${extra.join(', ')}`));
    // 임시·단시간 허용소비량
    if (/임시|단시간|허용소비량/.test(d.text) && !FREQ_RE.test(d.text.replace(/임시|단시간/g, ''))) out.push(F('error', '임시·단시간', `[${dept}] 임시·단시간 허용소비량 언급이 있으나 사용빈도(예: 월 2회)가 구체적이지 않습니다.`));
  }
  if (res.distribution.length && res.distribution.length !== byDept.size) out.push(F('warn', '분포실태', `분포실태 공정 ${res.distribution.length}개 ≠ 측정계획 부서 ${byDept.size}개`));
  // 6) 사용실태(화학물질 사용 상태) 비고에 적힌 유해인자 ↔ 측정계획, 임시·단시간 허용소비량 사용빈도
  for (const [dept, txt] of res.chemUseByDept || []) {
    const flat = norm(txt);
    const planned = new Set(res.plan.filter((p) => p.dept === dept).map((p) => canonHazard(p.hazard, aliases)));
    for (const [k, v] of Object.entries(aliases)) {
      if (!flat.includes(norm(k))) continue;
      const cv = canonHazard(k, aliases);
      if (res.plan.some((p) => p.dept) && !planned.has(cv)) out.push(F('error', '측정 누락', `[${dept}] 사용실태에 '${k}'(→${v}) 언급이 있으나 측정계획에 없습니다.`));
    }
    if (/임시|단시간|허용소비량/.test(txt) && !FREQ_RE.test(txt.replace(/임시|단시간/g, ''))) out.push(F('error', '임시·단시간', `[${dept}] 사용실태에 임시·단시간 허용소비량 표시가 있으나 비고에 사용빈도가 구체적이지 않습니다.`));
    if (/임시|단시간|허용소비량/.test(txt)) {
      const d = res.distribution.find((x) => /임시|단시간/.test(x.text) && x.hazards.some((h) => planned.has(canonHazard(h, aliases))));
      if (!d) out.push(F('error', '임시·단시간', `[${dept}] 임시·단시간 허용소비량 체크가 있으나 분포실태에 해당 내용이 기재되어 있지 않습니다.`));
    }
  }
  out.stats = { depts: byDept.size, planRows: res.plan.length, samples: res.samples.length, summary: res.summary.length };
  return out;
}

/** 결과서(PDF) → compareResultToEstimate 가 쓰는 rows 형태 (시료 1건 = row 1개) */
export const pdfRows = (res) => res.samples.map((s) => ({ hazards: s.hazards, dept: s.dept, work: s.dept, sheet: res.file, row: 0 }));
export { splitLines };
