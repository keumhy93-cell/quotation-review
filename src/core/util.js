import { XLSX } from './xlsx.js';

export const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const toNum = (v) => {
  if (isNum(v)) return v;
  if (v == null) return null;
  const n = Number(String(v).replace(/[,\s원건명%]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};

/** 워크북 → [{name, rows, isFormula(r,c)}] (r,c 는 0-base) */
export function readSheets(wb) {
  return wb.SheetNames.filter((n) => wb.Sheets[n]).map((name) => {
    const ws = wb.Sheets[name];
    // !ref 가 A1 이 아닌 곳(B2, A2…)에서 시작해도 행·열 번호가 실제 엑셀 위치와 같도록 A1 부터 읽는다
    const full = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const rows = full ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: { r: 0, c: 0 }, e: full.e } }) : [];
    const cellAt = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
    const isFormula = (r, c) => !!cellAt(r, c)?.f;
    const formula = (r, c) => cellAt(r, c)?.f ?? null;
    return { name, rows, isFormula, formula, hidden: false };
  });
}

export const findSheets = (sheets, keywords) =>
  sheets.filter((s) => keywords.some((k) => norm(s.name).includes(norm(k))));

/** 별칭 맵으로 헤더 행을 찾는다. aliases: {key:[키워드...]} */
export function findHeader(rows, aliases, minHits = 2, from = 0, colMin = 0, colMax = Infinity) {
  for (let r = from; r < Math.min(rows.length, 80); r++) {
    const cols = {};
    (rows[r] || []).forEach((cell, c) => {
      if (c < colMin || c > colMax) return;
      const t = norm(cell);
      if (!t) return;
      for (const [key, words] of Object.entries(aliases)) {
        if (key in cols) continue;
        if (words.some((w) => t.includes(norm(w)))) { cols[key] = c; break; }
      }
    });
    if (Object.keys(cols).length >= minHits) return { row: r, cols };
  }
  return null;
}

const TOTAL_RE = /합계|소계|총계|계$/;

/** 헤더 아래 표 데이터를 읽는다. 합계 행은 totals 로 분리 */
export function readTable(sheet, aliases, { minHits = 2, from = 0, colMin = 0, colMax = Infinity } = {}) {
  const h = findHeader(sheet.rows, aliases, minHits, from, colMin, colMax);
  if (!h) return null;
  const items = [], totals = [];
  let blank = 0;
  for (let r = h.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    if (row.every((v) => v == null || String(v).trim() === '')) { if (++blank >= 3) break; continue; }
    blank = 0;
    const rec = { sheet: sheet.name, row: r + 1, raw: row, f: {} };
    for (const [k, c] of Object.entries(h.cols)) { rec[k] = row[c]; rec.f[k] = sheet.isFormula(r, c); }
    const label = row.slice(0, Math.max(...Object.values(h.cols)) + 1).find((v) => typeof v === 'string' && v.trim());
    if (label && TOTAL_RE.test(norm(label).replace(/\d/g, '')) && !rec.hazard) totals.push(rec);
    else items.push(rec);
  }
  return { header: h, items, totals };
}

/** 현대 유해인자명: 물질명 안에 쉼표(1,1,2-…)와 '/'(물질 / 매체 / 기기)가 있으므로 '줄바꿈, ;, ", "(쉼표+공백)'만 구분자로 본다 */
export const splitLines = (s) => String(s ?? '').split(/\r?\n|;|,\s+/).map((x) => x.trim()).filter(Boolean);
/** 물질 짧은 이름 (결과서 유해인자명과 비교용) */
export const shortName = (s) => String(s ?? '').split('/')[0].replace(/\(.*?\)/g, '').trim();

export const HAZ_SPLIT = /[,，、\/\n+·;]+/;
export const normHazard = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[()（）]/g, (m) => (m === '(' || m === '（' ? '(' : ')')).toLowerCase();
export const splitHazards = (s) =>
  String(s ?? '').split(HAZ_SPLIT).map((x) => x.trim()).filter(Boolean);
export const isBlankSample = (s) => /공시료|blank/i.test(String(s ?? ''));

export const finding = (severity, category, message, where = '') => ({ severity, category, message, where });

export function countMap(list, keyFn, nFn = () => 1) {
  const m = new Map();
  for (const it of list) { const k = keyFn(it); m.set(k, (m.get(k) || 0) + nFn(it)); }
  return m;
}

/** 두 Map<string,number> 차이 */
export function diffMaps(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) || 0, y = b.get(k) || 0;
    if (x !== y) out.push({ key: k, a: x, b: y });
  }
  return out;
}

/** 작업환경측정 최소 건수: 1~10인 2건, 이후 5인마다 1건, 100인(20건) 상한 */
export function requiredSamples(persons) {
  if (!persons || persons < 1) return 0;
  if (persons <= 10) return 2;
  return Math.min(20, 2 + Math.ceil((persons - 10) / 5));
}

/** 실제 필요한 측정 건수: 근로자 수가 기준 건수보다 적으면 근로자 수만큼(예: 1명 → 1건) */
export const expectedSamples = (persons) => Math.min(persons, requiredSamples(persons));

/** 약칭 → 결과서식 유해인자명 (앞부분 일치). 비교용 키 반환 */
export function canonHazard(h, aliases = {}) {
  const cut = String(h).split('/')[0].replace(/공시료/g, '');
  const n = norm(cut.replace(/\s*\(.*$/, ''));
  for (const [k, v] of Object.entries(aliases)) if (n.startsWith(norm(k))) return norm(v);
  return norm(cut);
}
