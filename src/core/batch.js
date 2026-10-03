/**
 * 기관(센터)이 올린 파일 묶음을 한 번에 검토한다.
 *  1) 파일 역할 자동 분류 (견적 엑셀/견적 PDF/사업장 제출용/실시현황/결과서)
 *  2) 현장 단위로 견적·결과서·제출용·실시현황을 짝지어 각 검토 규칙 실행
 *  3) 짝이 없는 항목을 '누락' 으로 모아 알림 대상으로 돌려준다
 *
 * mode: 'adhoc'(수시: 견적서 ↔ 측정계획만) | 'quarter'(분기: 견적 ↔ 계획 ↔ 결과서 전체 흐름)
 */
import { finding as F, norm } from './util.js';
import { mergeConfig } from './config.js';
import { parseHyundai, parseSubmission, reviewHyundai, reviewSubmission } from './hyundai.js';
import { parseUnitPrice, reviewUnitPrice, compareBlockToResult, findBlock, blockGroups } from './unitprice.js';
import { parseResultText, reviewResultPdf } from './result-pdf.js';
import { parseResult } from './parsers.js';
import { reviewResult, compareResultToEstimate, compareMaterialToResult } from './rules-result.js';
import { isEstimatePdf, parseEstimatePdf, compareLaborToPlan, compareEstimatePdfToXlsx } from './estimate-pdf.js';
import { parseStatus, siteKey } from './status.js';

export const ROLES = {
  'hyundai-estimate': '현대 견적서(엑셀)', 'hyundai-submission': '사업장 제출용(엑셀)', 'unitprice-estimate': '수수료 산출근거(엑셀)',
  status: '실시현황(엑셀)', 'estimate-pdf': '견적서(PDF)', 'result-pdf': '결과서(PDF)', 'result-xlsx': '결과서(엑셀)', unknown: '분류 불가',
};

/** 엑셀: 시트 이름만으로 역할 판별 (큰 파일도 빠르다) */
export function classifyByNames(names) {
  const has = (re) => names.some((n) => re.test(n));
  if (has(/표준품셈/)) return 'hyundai-estimate';
  if (has(/수수료\s*산출근거/)) return 'unitprice-estimate';
  if (has(/작업환경측정계획서|측정계획서/) && has(/측정및분석재료비|분석재료비|재료비/)) return 'hyundai-submission';
  if (has(/실시현황/)) return 'status';
  return 'result-xlsx';
}
/** PDF 텍스트로 역할 판별 */
export function classifyPdfText(text) {
  if (/작업환경측정\s*결과/.test(text) && /별지\s*제8[23]호/.test(text)) return 'result-pdf';
  if (isEstimatePdf(text)) return 'estimate-pdf';
  return 'unknown';
}

const sameSite = (a, b) => { const x = siteKey(a), y = siteKey(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)))); };
const tag = (list, site, file) => list.map((f) => ({ ...f, site, file: f.file || file }));

/** 기관 이름 추정: 실시현황 측정기관 → 견적서 PDF 공급자 */
export function detectOrg(parsed) {
  for (const p of parsed.statuses || []) { const o = p.sites.map((s) => s.org).find(Boolean); if (o) return String(o).trim(); }
  const iss = (parsed.estimatePdfs || []).map((e) => e.issuer).find(Boolean);
  if (iss) return iss.replace(/^\(사\)\s*대한산업보건협회\s*/, '').trim() || iss;
  return '';
}

/**
 * @param {{company:string, mode:'adhoc'|'quarter', files:Array<{name,role,wb?,text?}>, cfg?:object}} p
 */
export function reviewBatch({ company, mode = 'quarter', files, cfg: userCfg }) {
  const cfg = mergeConfig(userCfg);
  const quarter = mode !== 'adhoc';
  const out = { sites: [], findings: [], missing: [], statuses: [], results: [], estimatePdfs: [], skipped: [], mode };
  const safe = (label, fn, fb) => { try { return fn(); } catch (e) { console.error(label, e); out.findings.push({ ...F('error', '검토 오류', `${label} 중 오류가 발생했습니다 (파일 양식 확인).`), site: '', file: '' }); return fb; } };

  // ── 읽기
  const byRole = (r) => files.filter((f) => f.role === r);
  const ests = byRole('hyundai-estimate').map((f) => ({ f, est: safe(`견적서 읽기(${f.name})`, () => parseHyundai(f.wb), null) })).filter((x) => x.est);
  const subs = byRole('hyundai-submission').map((f) => ({ f, sub: safe(`제출용 읽기(${f.name})`, () => parseSubmission(f.wb), null) })).filter((x) => x.sub);
  const unitFiles = byRole('unitprice-estimate').map((f) => ({ f, est: safe(`산출근거 읽기(${f.name})`, () => parseUnitPrice(f.wb), null) })).filter((x) => x.est);
  const estPdfs = byRole('estimate-pdf').map((f) => safe(`견적서 PDF 읽기(${f.name})`, () => parseEstimatePdf(f.text, f.name), null)).filter(Boolean);
  const results = [
    ...byRole('result-pdf').map((f) => safe(`결과서 읽기(${f.name})`, () => parseResultText(f.text, f.name), null)),
    ...byRole('result-xlsx').map((f) => safe(`결과서 읽기(${f.name})`, () => parseResult(f.wb, cfg, f.name), null)),
  ].filter(Boolean);
  for (const f of byRole('status')) { const p = safe(`실시현황 읽기(${f.name})`, () => parseStatus(f.wb, f.name), null); if (p) out.statuses.push(p); }
  for (const f of [...byRole('unitprice-estimate'), ...byRole('hyundai-submission')]) { const p = safe(`실시현황 읽기(${f.name})`, () => parseStatus(f.wb, f.name), null); if (p?.ok) out.statuses.push(p); }
  out.results = results; out.estimatePdfs = estPdfs;
  files.filter((f) => f.role === 'unknown').forEach((f) => out.skipped.push(f.name));

  const usedResults = new Set(), usedPdfs = new Set(), usedSubs = new Set();
  const pushSite = (name, file) => { const s = { name, key: siteKey(name), file, files: [], findings: [], missing: [] }; out.sites.push(s); return s; };
  const add = (site, list, file) => { const t = tag(list, site.name, file); site.findings.push(...t); out.findings.push(...t); };
  const miss = (site, kind, detail) => { const m = { site: site.name, kind, detail }; site.missing.push(m); out.missing.push(m); };

  if (company === 'hyundai') {
    for (const { f, est } of ests) {
      const name = est.siteName || f.name;
      const site = pushSite(name, f.name); site.files.push(f.name);
      add(site, safe('견적서 검토', () => reviewHyundai(est, cfg), []), f.name);
      est._reviewed = true;

      // 사업장 제출용: 현장명(실시현황) 또는 계획서 내용으로 짝짓기
      const sub = subs.find((s) => !usedSubs.has(s) && (s.sub.status?.site ? sameSite(s.sub.status.site, name) : subs.length === 1));
      if (sub) { usedSubs.add(sub); site.files.push(sub.f.name); add(site, safe('제출용 대조', () => reviewSubmission(sub.sub, est), []), sub.f.name); }

      // 견적서 PDF: 견적금액으로 짝짓기 (같은 금액이면 현장명 보조)
      // 견적금액이 같거나(읽지 못했으면 인건비+직접경비 금액이 같으면) 같은 견적으로 본다
      const pdf = estPdfs.find((p) => !usedPdfs.has(p) && ((p.gap.total != null && p.gap.total === est.gap?.total?.v) || (p.gap.total == null && p.gap.labor != null && p.gap.labor === est.gap?.labor?.v && p.gap.direct === est.gap?.direct?.v)) && (!p.site || sameSite(p.site, name) || estPdfs.length === 1));
      if (pdf) {
        usedPdfs.add(pdf); site.files.push(pdf.file);
        add(site, safe('견적서 PDF 대조', () => compareEstimatePdfToXlsx(pdf, est), []), pdf.file);
        add(site, safe('인건비 건수', () => compareLaborToPlan(pdf, sub ? sub.sub : est, sub ? '제출용 측정계획서' : '견적서 측정계획서'), []), pdf.file);
      } else if (estPdfs.length) miss(site, '견적서 PDF 없음', '업로드한 견적서 PDF 중 이 견적(견적금액)과 일치하는 것이 없습니다.');

      if (quarter) {
        const rs = results.filter((r) => !usedResults.has(r) && sameSite(r.cover?.site, name));
        if (!rs.length) miss(site, '결과서 없음', '이 현장의 결과서가 올라오지 않았습니다.');
        for (const r of rs) {
          usedResults.add(r); site.files.push(r.file);
          const rf = r.kind === 'pdf' ? reviewResultPdf(r, cfg) : reviewResult(r, cfg);
          add(site, safe('결과서 검토', () => rf, []), r.file);
        }
        if (rs.length) {
          const al = cfg.hazardAliases || {};
          add(site, safe('결과서↔견적서', () => [...compareResultToEstimate(rs, est, al), ...compareMaterialToResult(est, rs, al)], []), rs[0].file);
          for (const r of rs.filter((x) => x.kind === 'pdf')) {
            if (r.cover.period && est.period && r.cover.period !== est.period) add(site, [F('error', '결과서↔견적서', `견적 ${est.period} / 결과서 ${r.cover.period}`)], r.file);
          }
        }
      }
    }
    // 견적 엑셀 없이 PDF 만 있는 견적서
    for (const pdf of estPdfs.filter((p) => !usedPdfs.has(p))) {
      const site = pushSite(pdf.site || pdf.file, pdf.file); site.files.push(pdf.file);
      const sub = subs.find((s) => !usedSubs.has(s) && (s.sub.status?.site ? !pdf.site || sameSite(s.sub.status.site, pdf.site) : true));
      if (sub) { usedSubs.add(sub); site.files.push(sub.f.name); add(site, safe('인건비 건수', () => compareLaborToPlan(pdf, sub.sub, '제출용 측정계획서'), []), pdf.file); }
      else miss(site, '측정계획서 없음', '견적서 PDF 의 인건비 건수와 대조할 측정계획서(사업장 제출용 엑셀)가 없습니다.');
      if (quarter) {
        const rs = results.filter((r) => !usedResults.has(r) && pdf.site && sameSite(r.cover?.site, pdf.site));
        if (!rs.length) miss(site, '결과서 없음', '이 현장의 결과서가 올라오지 않았습니다.');
        for (const r of rs) { usedResults.add(r); site.files.push(r.file); add(site, r.kind === 'pdf' ? reviewResultPdf(r, cfg) : reviewResult(r, cfg), r.file); }
      }
    }
    for (const s of subs.filter((x) => !usedSubs.has(x))) {
      const site = pushSite(s.sub.status?.site || s.f.name, s.f.name); site.files.push(s.f.name);
      miss(site, '견적서 없음', '사업장 제출용 엑셀에 해당하는 견적서(엑셀/PDF)가 없습니다.');
    }
  } else {
    // 계룡·한화: 산출근거 파일의 현장 블록 ↔ 결과서
    for (const { f, est } of unitFiles) {
      const fileFindings = safe('산출근거 검토', () => reviewUnitPrice(est, cfg, company), []);
      for (const b of est.blocks) {
        const site = pushSite(b.name, f.name); site.files.push(f.name);
        const mine = fileFindings.filter((x) => new RegExp(`No\\.${b.no}\\b`).test(`${x.message} ${x.where}`));
        add(site, mine, f.name);
        if (quarter) {
          const rs = results.filter((r) => !usedResults.has(r) && r.cover?.site && findBlock({ blocks: [b] }, r.cover.site));
          if (!rs.length) miss(site, '결과서 없음', '이 현장의 결과서가 올라오지 않았습니다.');
          for (const r of rs) {
            usedResults.add(r); site.files.push(r.file);
            add(site, safe('결과서 검토', () => (r.kind === 'pdf' ? reviewResultPdf(r, cfg) : reviewResult(r, cfg)), []), r.file);
            add(site, safe('결과서↔견적', () => [...compareBlockToResult(b, r, cfg), ...compareResultToEstimate([r], { groups: blockGroups(b, cfg) }, cfg.hazardAliases || {}).map((x) => ({ ...x, message: `No.${b.no} ${x.message}` }))], []), r.file);
          }
        }
      }
      // 파일 전체 수준(블록에 안 걸린) 결과
      const general = fileFindings.filter((x) => !est.blocks.some((b) => new RegExp(`No\\.${b.no}\\b`).test(`${x.message} ${x.where}`)));
      if (general.length) { const g = out.sites[0] || pushSite('(파일 전체)', f.name); add(g, general, f.name); }
    }
  }

  // 결과서만 있고 견적이 없는 현장
  if (quarter) for (const r of results.filter((x) => !usedResults.has(x))) {
    const site = pushSite(r.cover?.site || r.file, r.file); site.files.push(r.file);
    miss(site, '견적서 없음', '이 결과서에 해당하는 견적서(현장)를 찾지 못했습니다.');
    add(site, r.kind === 'pdf' ? reviewResultPdf(r, cfg) : reviewResult(r, cfg), r.file);
  }

  // 실시현황 ↔ 현장 누락 (실시현황에 행이 있으면 견적/결과서가, 견적/결과서가 있으면 실시현황 행이 있어야 한다)
  const stSites = out.statuses.flatMap((p) => p.sites.map((s) => ({ ...s, file: p.file })));
  if (stSites.length) {
    for (const st of stSites) if (!out.sites.some((x) => sameSite(x.name, st.name))) { const m = { site: st.name, kind: '견적·결과서 없음', detail: `실시현황(${st.file}) 에는 있으나 견적서·결과서가 올라오지 않았습니다.` }; out.missing.push(m); }
    for (const s of out.sites) if (!stSites.some((st) => sameSite(s.name, st.name))) miss(s, '실시현황 행 없음', '이 현장이 실시현황 엑셀에 없습니다.');
  }
  out.detectedOrg = detectOrg(out);
  out.stats = { sites: out.sites.length, files: files.length, missing: out.missing.length, error: out.findings.filter((x) => x.severity === 'error').length, warn: out.findings.filter((x) => x.severity === 'warn').length };
  return out;
}
