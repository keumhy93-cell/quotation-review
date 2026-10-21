/**
 * 결과서 사용실태 점검표.
 *  ① 화학물질 사용 상태 '비고'에 적힌 유해인자 ↔ 대상유해인자(측정결과 요약·측정계획) 목록이 다른 경우와 그 사유
 *  ② '임시·단시간·허용소비량' 표시가 있는 행에 사용 주기(주 n회·월 n회…)·시간·면적이 비고/분포실태/공정정보에 적혀 있는지
 * 결과서(PDF) 한 건 → 점검 행. 여러 건(2분기·3분기 …)을 모아 엑셀로 만든다.
 */
import { norm, canonHazard } from './util.js';
import { splitUsage } from './usage.js';
import { parseResultText } from './result-pdf.js';
import { mentionedHazards } from './rules-usage.js';
import { buildReportXlsx, head, detailSheet, PALETTE } from './xlsx-report.js';

export const TEMP_MARK = /임시|단시간|허용\s*소비량/;
const FREQ = /(주\s*\d+\s*(회|일)|월\s*\d+\s*(회|일)|일\s*\d+\s*회|연\s*\d+\s*회|\d+\s*회\s*\/\s*(주|월|일|년)|(주|월|일|년)\s*\d+\s*[~\-]\s*\d+\s*회|\d+\s*(주|월)\s*에\s*\d+\s*회|매일|매주|매월|격주)/;
const DUR = /\d+(\.\d+)?\s*(분|시간)/;
const AREA = /(\d+(\.\d+)?\s*(㎡|m2|m²|㎡|제곱미터|평)|면적)/i;
const snip = (t, m) => { const i = m.index; return t.slice(Math.max(0, i - 12), i + m[0].length + 14).replace(/\s+/g, ' ').trim(); };

const compact = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 결과서 한 건에서 사용실태 행 → 점검 행 */
export function auditResult(res, text, cfg, ctx = {}) {
  const aliases = cfg.hazardAliases || {};
  const base = { period: ctx.period || '', org: ctx.org || '', site: res.cover?.site || '', file: res.file };
  const mism = [], temps = [];
  const summary = new Set((res.summary || []).map((s) => canonHazard(s.hazard, aliases)));
  const known = [...new Set([...(res.summary || []).map((s) => s.hazard), ...(res.plan || []).map((p) => p.hazard)])];
  const lines = String(text || '').split('\n');
  const chemStart = lines.findIndex((l) => /다\.\s*공정별\s*화학물질\s*사용/.test(l)), chemEnd = lines.findIndex((l, i) => i > chemStart && /나-1\.|단위작업\s*장소별/.test(l));
  const outside = lines.filter((_, i) => !(chemStart >= 0 && i >= chemStart && i < (chemEnd < 0 ? chemStart + 40 : chemEnd)));
  const distFor = (dept) => (res.distribution || []).filter((d) => d.label && (norm(d.label).includes(norm(dept)) || norm(dept).includes(norm(d.label))));

  for (const r of res.usageRows || []) {
    const u = splitUsage(r.text), dept = r.dept || '';
    const rowText = compact(r.text), note = compact(u.note || '');
    const planned = new Map((res.plan || []).filter((p) => p.dept === dept).map((p) => [canonHazard(p.hazard, aliases), p.hazard]));
    const planList = [...new Set([...planned.values()])].join(', ');
    const dists = distFor(dept), distText = compact(dists.map((d) => d.text).join(' '));
    const mention = mentionedHazards(rowText, aliases, known);
    const tempMark = (rowText.match(TEMP_MARK) || [])[0];

    // ── ② 임시·단시간·허용소비량 점검
    if (tempMark) {
      const sources = [['사용실태 비고', rowText], ['분포실태', distText], ['공정정보·본문', outside.filter((l) => norm(l).includes(norm(dept))).join(' ')]];
      const find = (re) => { for (const [name, t] of sources) { const m = t.replace(/임시|단시간/g, ' ').match(re); if (m) return { src: name, ev: snip(t, m) }; } return null; };
      const f = find(FREQ), d = find(DUR), a = find(AREA);
      const missing = [!f && '주기(주 n회·월 n회 등)', !a && '면적'].filter(Boolean);
      temps.push({ ...base, dept, product: u.product || rowText.slice(0, 30), mark: (rowText.match(new RegExp(TEMP_MARK.source, 'g')) || []).join('·'), note: note || rowText, freq: f ? '기재' : '미기재', freqEv: f ? `${f.ev} (${f.src})` : '', dur: d ? `${d.ev} (${d.src})` : '', area: a ? '기재' : '미기재', areaEv: a ? `${a.ev} (${a.src})` : '',
        verdict: missing.length === 0 ? '확인됨' : (f || a) ? '주의' : '오류', reason: missing.length ? `${missing.join('·')} 이(가) 비고·분포실태·공정정보 어디에도 적혀 있지 않습니다.` : '주기와 면적이 기재되어 있습니다.' });
    }

    // ── ① 비고 ↔ 대상유해인자
    for (const [k, mv] of mention) {
      const m = { name: typeof mv === 'string' ? mv : mv.name };
      const inSummary = summary.has(k), inPlan = planned.has(k);
      if (inSummary && inPlan) continue;
      const nm = norm(m.name);
      const temp = tempMark && TEMP_MARK.test(rowText), freq = FREQ.test(rowText.replace(/임시|단시간/g, ''));
      const aliasKeys = Object.keys(aliases).filter((a) => canonHazard(a, aliases) === k).concat(m.name);
      const distNamed = dists.some((d) => aliasKeys.some((a) => norm(d.text).includes(norm(a))));
      const distGeneric = dists.some((d) => /(사유|제외|미측정|소량|극소량|해당\s*없|사용\s*(안|하지)|허용소비량|임시|단시간)/.test(d.text));
      let verdict, reason;
      if (temp && freq) { verdict = '확인됨'; reason = '임시·단시간 허용소비량 이하 표시와 사용 주기가 비고에 기재되어 있어 측정 제외 사유가 있습니다.'; }
      else if (distNamed) { verdict = '확인됨'; reason = `분포실태에 해당 유해인자와 사유가 기재되어 있습니다 (${distText.slice(0, 50)}…).`; }
      else if (temp) { verdict = '오류'; reason = '임시·단시간 허용소비량 표시는 있으나 사용 주기(주 n회·월 n회)가 적혀 있지 않고 분포실태 사유도 없습니다.'; }
      else if (distGeneric) { verdict = '주의'; reason = '분포실태에 사유성 문구는 있으나 이 유해인자가 언급되어 있지 않습니다 — 분포실태에 해당 유해인자와 사유를 적었는지 확인하세요.'; }
      else { verdict = '오류'; reason = '측정 대상 유해인자에 없는데 임시·단시간(허용소비량 이하) 표시도, 분포실태 사유도 없습니다 — 측정 누락 또는 사유 기재 누락.'; }
      mism.push({ ...base, dept, kind: !inSummary ? '비고에만 있음 (대상유해인자 결과에 없음)' : '비고에 있으나 이 공정 측정계획에 없음', hazard: m.name, product: u.product || '', note: note || rowText, planList, verdict, reason });
    }
    // 반대: 이 공정 측정계획의 화학인자(분진·흄 제외)가 사용실태 비고에 전혀 안 나오는 경우 (참고)
    if (mention.size) for (const [k, name] of planned) {
      if (mention.has(k) || /분진|흄|소음/.test(name)) continue;
      if ((res.usageRows || []).filter((x) => x.dept === dept).some((x) => mentionedHazards(x.text, aliases, known).has(k))) continue;
      if (!mism.some((x) => x.dept === dept && x.hazard === name && x.kind.startsWith('측정계획에만'))) mism.push({ ...base, dept, kind: '측정계획에만 있음 (사용실태 비고에 없음)', hazard: name, product: '', note: '', planList, verdict: '참고', reason: '측정은 했으나 이 공정의 사용실태 비고에는 나오지 않습니다 (비고 기재 확인).' });
    }
  }
  return { mism, temps };
}

/** 저장된 작업(여러 분기)의 결과서 PDF 를 모두 점검 → 엑셀 */
export async function buildUsageAuditXlsx(ws, projects, cfg) {
  const mism = [], temps = [], skipped = [], counts = [];
  for (const p of projects) {
    const c = ws.collect(p); let n = 0;
    for (const f of c.results) {
      if (f.role !== 'result-pdf' || !f.textHash) { skipped.push(`${p.period} ${f.org} ${f.name}`); continue; }
      const buf = await ws.store.getBlob(f.textHash); if (!buf) { skipped.push(`${p.period} ${f.org} ${f.name} (저장 본문 없음)`); continue; }
      const text = new TextDecoder().decode(new Uint8Array(buf));
      const res = parseResultText(text, f.name);
      const a = auditResult(res, text, cfg, { period: p.period, org: f.org }); mism.push(...a.mism); temps.push(...a.temps); n++;
    }
    counts.push([p.period, n]);
  }
  const V = { 오류: 0, 주의: 1, 참고: 2, 확인됨: 3 }, byV = (a, b) => V[a.verdict] - V[b.verdict] || a.period.localeCompare(b.period) || a.site.localeCompare(b.site, 'ko');
  mism.sort(byV); temps.sort(byV);
  const n = (list, v) => list.filter((x) => x.verdict === v).length;
  const sum = [head(['점검 항목', '건수', '오류', '주의', '확인됨·참고']),
    ['사용실태 비고 ↔ 대상유해인자 불일치', mism.length, n(mism, '오류'), n(mism, '주의'), n(mism, '확인됨') + n(mism, '참고')].map((v, i) => (i >= 2 && v > 0 ? { v, bold: true, color: PALETTE[i === 2 ? 'error' : i === 3 ? 'warn' : 'info'].text, fill: PALETTE[i === 2 ? 'error' : i === 3 ? 'warn' : 'info'].strong, h: 'center' } : i ? { v, h: 'center' } : { v, bold: true })),
    ['임시·단시간·허용소비량 (주기·면적 기재 여부)', temps.length, n(temps, '오류'), n(temps, '주의'), n(temps, '확인됨')].map((v, i) => (i >= 2 && v > 0 ? { v, bold: true, color: PALETTE[i === 2 ? 'error' : i === 3 ? 'warn' : 'info'].text, fill: PALETTE[i === 2 ? 'error' : i === 3 ? 'warn' : 'info'].strong, h: 'center' } : i ? { v, h: 'center' } : { v, bold: true })),
    [], [{ v: '점검한 결과서', bold: true }], ...counts.map(([per, k]) => [per, `${k}건`]),
    ...(skipped.length ? [[], [{ v: '점검하지 못한 파일(PDF 본문이 저장되지 않았거나 엑셀 결과서)', bold: true, color: PALETTE.warn.text }], ...skipped.map((s) => [s])] : [])];
  const sheets = [{ name: '요약', rows: sum, widths: [52, 10, 8, 8, 14], freeze: false }];
  sheets.push(mism.length ? detailSheet('①비고↔대상유해인자', ['기간', '기관', '현장', '공정(부서)', '구분', '유해인자', '판정', '사유', '사용 제품(상품명)', '비고 원문', '이 공정 측정계획 유해인자', '결과서 파일'],
    mism.map((x) => [x.period, x.org, x.site, x.dept, x.kind, x.hazard, x.verdict, x.reason, x.product, x.note, x.planList, x.file]), { catCol: 4, sevCol: 6, widths: [10, 12, 32, 16, 28, 22, 8, 56, 22, 40, 36, 30] }) : { name: '①비고↔대상유해인자', rows: [['불일치 없음']] });
  sheets.push(temps.length ? detailSheet('②임시·단시간·허용소비량', ['기간', '기관', '현장', '공정(부서)', '표기', '판정', '부족한 내용', '사용 제품(상품명)', '비고 원문', '주기', '주기 근거(위치)', '시간(참고)', '면적', '면적 근거(위치)', '결과서 파일'],
    temps.map((x) => [x.period, x.org, x.site, x.dept, x.mark, x.verdict, x.reason, x.product, x.note, x.freq, x.freqEv, x.dur, x.area, x.areaEv, x.file]), { catCol: 4, sevCol: 5, widths: [10, 12, 32, 16, 14, 8, 44, 22, 40, 8, 34, 24, 8, 34, 30] }) : { name: '②임시·단시간·허용소비량', rows: [['임시·단시간·허용소비량 표시 없음']] });
  return { bytes: await buildReportXlsx(sheets), mism, temps, skipped };
}
