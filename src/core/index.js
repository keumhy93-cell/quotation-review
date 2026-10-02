import { parseResult } from './parsers.js';
import { parseHyundai, parseSubmission, reviewHyundai, reviewSubmission } from './hyundai.js';
import { parseUnitPrice, reviewUnitPrice, compareBlockToResult, findBlock, blockGroups } from './unitprice.js';
import { parseResultText, reviewResultPdf } from './result-pdf.js';
import { reviewResult, reviewResultSet, compareResultToEstimate } from './rules-result.js';
import { DEFAULT_CONFIG } from './config.js';
import { finding as F } from './util.js';

/**
 * @param {object} p
 *  company: 'hyundai' | 'gyeryong' | 'hanwha'
 *  type?: 현대 견적 유형 직접 지정 ('정기자동' …) — 생략하면 파일 구조로 자동 판별
 *  estimateWb: 견적서 통합문서(XLSX 객체)
 *  submissionWb?: (현대) 사업장 제출용 엑셀
 *  results: [{ name, wb?, text? }]  결과서 — 엑셀은 wb, PDF 는 추출한 텍스트(text)
 */
export function runReview({ company, type, estimateWb, submissionWb, results = [], resultWbs = [], cfg = DEFAULT_CONFIG }) {
  const res = { estimate: [], submission: [], results: [], resultSet: [], compare: [] };
  const hyundai = company === 'hyundai';
  let est = null;
  if (estimateWb) {
    if (hyundai) { est = parseHyundai(estimateWb); res.estimate = reviewHyundai(est, cfg, type); }
    else { est = parseUnitPrice(estimateWb); res.estimate = reviewUnitPrice(est, cfg); }
    res.estimateStats = res.estimate.stats;
  }
  if (est && submissionWb && hyundai) res.submission = reviewSubmission(parseSubmission(submissionWb), est);

  const inputs = [...results, ...resultWbs.map((x) => ({ name: x.name, wb: x.wb }))];
  const parsed = inputs.map((r) => (r.text != null ? parseResultText(r.text, r.name) : parseResult(r.wb, cfg, r.name)));
  for (const p of parsed) {
    const f = p.kind === 'pdf' ? reviewResultPdf(p, cfg) : reviewResult(p, cfg);
    res.results.push(...f.map((x) => ({ ...x, file: p.file })));
  }
  res.resultSet = reviewResultSet(parsed);

  if (est) {
    const al = cfg.hazardAliases || {};
    if (hyundai) {
      if (parsed.length) res.compare = compareResultToEstimate(parsed, est, al);
      for (const p of parsed.filter((x) => x.kind === 'pdf')) {
        if (p.cover.period && est.period && p.cover.period !== est.period) res.compare.push(F('error', '결과서↔견적서', `견적 ${est.period} / 결과서 ${p.cover.period} (${p.file})`));
        const laborN = est.labor?.persons?.v;
        if (p.cover.workers != null && laborN != null && p.cover.workers < laborN) res.compare.push(F('warn', '결과서↔견적서', `결과서 근로자 수 ${p.cover.workers}명 < 견적 측정 대상 인원 ${laborN}명 (${p.file})`));
      }
    } else {
      for (const p of parsed) {
        const name = p.cover?.site;
        const b = name ? findBlock(est, name) : null;
        if (!b) { res.compare.push(F('error', '결과서↔견적서', `${p.file}: 결과서 현장(${name ?? '?'})에 해당하는 견적 블록을 찾지 못했습니다.`)); continue; }
        res.compare.push(...compareBlockToResult(b, p, cfg).map((x) => ({ ...x, file: p.file })));
        res.compare.push(...compareResultToEstimate([p], { groups: blockGroups(b, cfg) }, al).map((x) => ({ ...x, file: p.file, message: `No.${b.no} ${x.message}` })));
      }
    }
  }
  return res;
}
export { DEFAULT_CONFIG };
