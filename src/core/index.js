import { parseResult } from './parsers.js';
import { parseHyundai, parseSubmission, reviewHyundai, reviewSubmission } from './hyundai.js';
import { parseUnitPrice, reviewUnitPrice, compareBlockToResult, findBlock, blockGroups } from './unitprice.js';
import { parseResultText, reviewResultPdf } from './result-pdf.js';
import { reviewResult, reviewResultSet, compareResultToEstimate, compareMaterialToResult } from './rules-result.js';
import { DEFAULT_CONFIG, mergeConfig } from './config.js';
import { finding as F } from './util.js';

/**
 * @param {object} p
 *  company: 'hyundai' | 'gyeryong' | 'hanwha'
 *  type?: 현대 견적 유형 직접 지정 ('정기자동' …) — 생략하면 파일 구조로 자동 판별
 *  estimateWb: 견적서 통합문서(XLSX 객체)
 *  submissionWb?: (현대) 사업장 제출용 엑셀
 *  results: [{ name, wb?, text? }]  결과서 — 엑셀은 wb, PDF 는 추출한 텍스트(text)
 */
export function runReview({ company, type, estimateWb, submissionWb, results = [], resultWbs = [], cfg: userCfg }) {
  const cfg = mergeConfig(userCfg);
  const res = { estimate: [], submission: [], results: [], resultSet: [], compare: [] };
  // 한 단계에서 예외가 나도 다른 단계 결과는 살리고, 화면에는 '검토 중 오류' 로 보여 준다
  const safe = (label, fn, fallback) => {
    try { return fn(); } catch (e) { console.error(label, e); (res._failed ||= []).push(label); return fallback; }
  };
  const fail = (bucket, label) => res[bucket].push(F('error', '검토 오류', `${label} 중 오류가 발생했습니다. 파일 양식이 예상과 다른지 확인하세요 (상세 내용은 브라우저 콘솔).`));
  const hyundai = company === 'hyundai';
  let est = null;
  if (estimateWb) {
    est = safe('견적서 읽기', () => (hyundai ? parseHyundai(estimateWb) : parseUnitPrice(estimateWb)), null);
    if (!est) fail('estimate', '견적서 읽기');
    else {
      res.estimate = safe('견적서 검토', () => (hyundai ? reviewHyundai(est, cfg, type) : reviewUnitPrice(est, cfg, company)), []);
      if (res._failed?.includes('견적서 검토')) fail('estimate', '견적서 검토');
      res.estimateStats = res.estimate.stats;
    }
  }
  if (est && submissionWb && hyundai) {
    res.submission = safe('제출용 엑셀 검토', () => reviewSubmission(parseSubmission(submissionWb), est), []);
    if (res._failed?.includes('제출용 엑셀 검토')) fail('submission', '제출용 엑셀 검토');
  }

  const inputs = [...results, ...resultWbs.map((x) => ({ name: x.name, wb: x.wb }))];
  const parsed = [];
  for (const r of inputs) {
    const p = safe(`결과서 읽기(${r.name})`, () => (r.text != null ? parseResultText(r.text, r.name) : parseResult(r.wb, cfg, r.name)), null);
    if (!p) { fail('results', `결과서 읽기(${r.name})`); continue; }
    parsed.push(p);
    const f = safe(`결과서 검토(${r.name})`, () => (p.kind === 'pdf' ? reviewResultPdf(p, cfg) : reviewResult(p, cfg)), []);
    res.results.push(...f.map((x) => ({ ...x, file: p.file })));
  }
  res.resultSet = safe('결과서 간 비교', () => reviewResultSet(parsed), []);

  if (est && parsed.length) {
    const al = cfg.hazardAliases || {};
    res.compare = safe('결과서↔견적서 비교', () => {
      const out = [];
      if (hyundai) {
        out.push(...compareResultToEstimate(parsed, est, al));
        out.push(...compareMaterialToResult(est, parsed, al));
        for (const p of parsed.filter((x) => x.kind === 'pdf')) {
          if (p.cover.period && est.period && p.cover.period !== est.period) out.push(F('error', '결과서↔견적서', `견적 ${est.period} / 결과서 ${p.cover.period} (${p.file})`));
          const laborN = est.labor?.persons?.v;
          if (p.cover.workers != null && laborN != null && p.cover.workers < laborN) out.push(F('warn', '결과서↔견적서', `결과서 근로자 수 ${p.cover.workers}명 < 견적 측정 대상 인원 ${laborN}명 (${p.file})`));
        }
      } else {
        for (const p of parsed) {
          const name = p.cover?.site;
          const b = name ? findBlock(est, name) : null;
          if (!b) { out.push(F('error', '결과서↔견적서', `${p.file}: 결과서 현장(${name ?? '?'})에 해당하는 견적 블록을 찾지 못했습니다.`)); continue; }
          out.push(...compareBlockToResult(b, p, cfg).map((x) => ({ ...x, file: p.file })));
          out.push(...compareResultToEstimate([p], { groups: blockGroups(b, cfg) }, al).map((x) => ({ ...x, file: p.file, message: `No.${b.no} ${x.message}` })));
        }
      }
      return out;
    }, []);
    if (res._failed?.includes('결과서↔견적서 비교')) fail('compare', '결과서↔견적서 비교');
  }
  delete res._failed;
  return res;
}
export { DEFAULT_CONFIG, mergeConfig };
