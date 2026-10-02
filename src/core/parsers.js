import { readSheets, findSheets, readTable, toNum, splitHazards } from './util.js';

const RESULT_ALIASES = {
  dept: ['부서', '공정'],
  work: ['단위작업', '작업명'],
  persons: ['인원', '근로자수'],
  hazard: ['유해인자', '측정대상'],
  usage: ['사용실태', '사용실태비고', '사용물질'],
  dist: ['분포실태', '분포'],
  temp: ['임시', '단시간', '허용소비량'],
  value: ['측정치', '측정결과', '결과', '농도', 'twa'],
  limit: ['노출기준', '허용기준'],
  exceed: ['초과'],
  note: ['비고'],
};


const CHECKED = /[☑✔✓■●√]|^(v|o|y|1|true)$/i;

export function parseResult(wb, cfg, fileName = '') {
  const sheets = readSheets(wb);
  const out = { file: fileName, rows: [], cover: {}, warnings: [] };

  for (const s of sheets) {
    const t = readTable(s, RESULT_ALIASES, { minHits: 3 });
    if (!t) continue;
    let dept = '', work = '';
    for (const it of t.items) {
      if (it.dept) dept = String(it.dept).trim(); else it.dept = dept;
      if (it.work) work = String(it.work).trim(); else it.work = work;
      if (!String(it.hazard ?? '').trim() && !String(it.usage ?? '').trim()) continue;
      const tempRaw = it.temp;
      out.rows.push({
        ...it,
        hazards: splitHazards(it.hazard),
        usageHazards: splitHazards(it.usage),
        persons: toNum(it.persons),
        value: toNum(it.value),
        limit: toNum(it.limit),
        tempChecked: tempRaw != null && CHECKED.test(String(tempRaw).trim()),
        exceedFlag: it.exceed != null && CHECKED.test(String(it.exceed).trim()),
      });
    }
  }
  if (!out.rows.length) out.warnings.push('결과서에서 측정 결과 표(유해인자/사용실태/분포실태 등)를 찾지 못했습니다.');

  const cover = findSheets(sheets, cfg.sheets.resultCover)[0] || sheets[0];
  if (cover) {
    const lines = cover.rows.map((r) => (r || []).map((v) => (v == null ? '' : String(v))).join(' '));
    out.cover.text = lines.join('\n');
    out.cover.consecutiveLess = lines.find((l) => /2\s*회\s*연속\s*미만/.test(l)) || null;
    // "2회 연속 미만" 뒤쪽에 체크표시가 붙은 경우
    out.cover.consecutiveLessChecked = lines.some((l) => /2\s*회\s*연속\s*미만\s*[☑✔✓■●√]|[☑✔✓■●√]\s*2\s*회\s*연속\s*미만/.test(l));
    out.cover.site = (cover.rows.flat().map(String).join('|').match(/사업장명?\s*[:|]?\s*\|?\s*([^|]+)/) || [])[1]?.trim();
  }
  return out;
}

