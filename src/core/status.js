/**
 * 실시현황(분기 실시 현황) 파서 + 취합(병합) + 엑셀 생성.
 *
 * 세 건설사 양식은 열 구성이 다르지만 구조가 같다.
 *   제목행(■ 20XX년 …실시현황) / (정렬기준) / 헤더(현대는 2행) / 현장별 블록
 *   현장 블록 = 첫 행(연번·날짜·현장명·주소·구분·…·수수료) + 이어지는 행(평가·인자만) — 나머지 열은 세로 병합
 *   현대: No|예비조사일|본측정일|소요일|[현장코드]현장명|주소|구분|총근로자수|평가|인자|특별관리물질…|측정기관|담당자|직접경비(출장여비·감가상각비·재료비)|최종수수료
 *   계룡: No|예비조사일|본측정일|소요일|현장명|주소|구분|평가|인자|측정기관|담당자|최종수수료|비고
 *   한화: 계룡에서 비고 없음
 * 열 위치는 헤더 글자로 찾으므로 각사 양식이 조금 달라져도 동작한다.
 */
import { XLSX } from './xlsx.js';
import { readSheets, norm, toNum, finding as F } from './util.js';

const FIELD_RULES = [
  ['no', /^no\.?$/], ['prelim', /예비조사일/], ['date', /본측정일/], ['days', /소요일/], ['name', /현장명/], ['address', /주소/],
  ['kind', /^구분$/], ['workers', /근로자/], ['eval', /^평가$/], ['hazard', /^인자$/],
  ['special', /특별관리물질을?함유/], ['specialHaz', /^특별관리물질유해인자$|^특별관리물질$/],
  ['org', /측정기관/], ['person', /담당자/], ['travel', /출장여비/], ['dep', /감가상각비/], ['mat', /^재료비/], ['fee', /최종수수료/], ['note', /비고/],
];
const MONEY_Z = '#,##0';
const DATE_Z = 'm"/"d;@';

const cellVal = (c) => (c == null || c === '' ? null : c);

/** 헤더 행에서 필드 → 열 인덱스 */
function mapColumns(rows, h) {
  const cols = {};
  const maxC = Math.max(...[rows[h], rows[h + 1]].filter(Boolean).map((r) => r.length), 0);
  for (let c = 0; c < maxC; c++) {
    const texts = [rows[h + 1]?.[c], rows[h]?.[c]].map((v) => norm(v)).filter(Boolean); // 아래 행(세부 헤더) 우선
    for (const t of texts) {
      const hit = FIELD_RULES.find(([k, re]) => !(k in cols) && re.test(t));
      if (hit) { cols[hit[0]] = c; break; }
    }
  }
  return cols;
}

/**
 * @returns {{ ok, file, sheet, title, template, cols, sites:[{no,prelim,date,days,name,address,kind,workers,items:[{eval,hazard}],special,specialHaz,org,person,travel,dep,mat,fee,note,srcRow}], warnings }}
 */
export function parseStatus(wb, file = '') {
  const sh = readSheets(wb).find((s) => s.name.includes('실시현황'));
  if (!sh) return { ok: false, file, sites: [], warnings: ["'실시현황' 시트를 찾지 못했습니다."] };
  const rows = sh.rows;
  const h = rows.findIndex((r) => (r || []).some((v) => /^no\.?$/.test(norm(v))) && (r || []).some((v) => /현장명/.test(norm(v))));
  if (h < 0) return { ok: false, file, sites: [], warnings: ["'실시현황' 시트에서 헤더(No./현장명)를 찾지 못했습니다."] };
  const cols = mapColumns(rows, h);
  if (cols.name == null || cols.no == null) return { ok: false, file, sites: [], warnings: ['실시현황 헤더에서 No.·현장명 열을 찾지 못했습니다.'] };

  // 헤더 블록 끝: 헤더 다음 행이 세부 헤더(숫자 No 없음 + 텍스트만)면 2행 헤더
  let dataStart = h + 1;
  const next = rows[h + 1] || [];
  if (toNum(next[cols.no]) == null && next.some((v) => typeof v === 'string' && v.trim()) && !next[cols.name]) dataStart = h + 2;

  const title = rows.slice(0, h).flat().find((v) => typeof v === 'string' && /■|실시현황/.test(v)) || '';
  const out = { ok: true, file, sheet: sh.name, title, cols, sites: [], warnings: [], headerRow: h, dataStart };

  // 템플릿(제목·헤더 영역)을 값/서식/병합/열너비까지 저장 → 취합본에 그대로 복원
  const ws = wb.Sheets[sh.name];
  const cells = [];
  for (let r = 0; r < dataStart; r++) for (let c = 0; c < (rows[r] || []).length; c++) {
    const x = ws[XLSX.utils.encode_cell({ r, c })]; if (x && x.v != null && x.v !== '') cells.push({ r, c, v: x.v, t: x.t, z: x.z });
  }
  out.template = {
    cells,
    merges: (ws['!merges'] || []).filter((m) => m.e.r < dataStart),
    colWidths: (ws['!cols'] || []).map((c) => (c && (c.wch || c.wpx) ? { wch: c.wch, wpx: c.wpx } : null)),
    width: Math.max(...rows.slice(0, dataStart).map((r) => (r || []).length), 0),
    dataStart,
  };

  let cur = null;
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const no = toNum(row[cols.no]);
    const name = cellVal(row[cols.name]);
    if (no != null && name != null) {
      cur = { no, srcRow: r + 1, items: [], name: String(name).trim() };
      for (const k of ['prelim', 'date', 'days', 'address', 'kind', 'workers', 'special', 'specialHaz', 'org', 'person', 'travel', 'dep', 'mat', 'fee', 'note']) if (k in cols) cur[k] = cellVal(row[cols[k]]);
      out.sites.push(cur);
    }
    if (cur && ((cols.eval != null && cellVal(row[cols.eval])) || (cols.hazard != null && cellVal(row[cols.hazard])))) {
      cur.items.push({ eval: cols.eval != null ? cellVal(row[cols.eval]) : null, hazard: cols.hazard != null ? cellVal(row[cols.hazard]) : null });
    }
  }
  if (!out.sites.length) out.warnings.push('실시현황에 현장 행이 없습니다.');
  return out;
}

/** 현장 비교용 키: [코드]·상호 접두를 떼고 공백 제거 */
export const siteKey = (name) => norm(String(name ?? '').replace(/^\[[^\]]*\]/, '').replace(/^.*?[-－–]\s*(?=\S)/, (m) => (/건설|산업|㈜|\(주\)|한화|주식회사/.test(m) ? '' : m)).replace(/[㈜()（）]|\(주\)/g, ''));
const dupKey = (s) => `${siteKey(s.name)}|${String(s.kind ?? '').trim()}|${typeof s.date === 'number' ? s.date : String(s.date ?? '')}`;

/**
 * 여러 실시현황을 하나로 합친다. 연번은 files 배열 순서(= 업로드 순서) → 파일 안 행 순서대로 1부터 다시 붙인다.
 * @param {Array<{name:string, parsed:object}>} files  parseStatus 결과 목록 (순서가 곧 연번 순서)
 * @param {{title?:string, skipDuplicates?:boolean, startNo?:number}} opt
 * @returns {{ok, template, cols, title, sites, duplicates:[{key,name,files}], warnings, findings}}
 */
export function mergeStatus(files, opt = {}) {
  const findings = [];
  const usable = files.filter((f) => f.parsed?.ok);
  files.filter((f) => !f.parsed?.ok).forEach((f) => findings.push(F('error', '실시현황', `${f.name}: ${f.parsed?.warnings?.[0] || '읽을 수 없는 파일'}`)));
  if (!usable.length) return { ok: false, sites: [], duplicates: [], findings, warnings: [] };

  const first = usable[0].parsed;
  const sites = [], seen = new Map(), duplicates = [];
  const missingCols = new Set();
  for (const f of usable) {
    // 양식 차이: 첫 파일(기준 양식)에 없는 열은 버려지고, 있는데 이 파일에 없는 열은 빈칸
    for (const k of Object.keys(f.parsed.cols)) if (!(k in first.cols) && !['eval', 'hazard'].includes(k)) missingCols.add(`${f.name}: '${k}' 열은 기준 양식(첫 파일)에 없어 제외`);
    for (const s of f.parsed.sites) {
      const key = dupKey(s);
      if (seen.has(key)) {
        let d = duplicates.find((x) => x.key === key);
        if (!d) { d = { key, name: s.name, files: [seen.get(key).file] }; duplicates.push(d); }
        d.files.push(f.name);
        if (opt.skipDuplicates) continue;
      } else seen.set(key, { file: f.name });
      sites.push({ ...s, items: s.items.map((i) => ({ ...i })), from: f.name });
    }
  }
  const start = opt.startNo ?? 1;
  sites.forEach((s, i) => { s.srcNo = s.no; s.no = start + i; });
  const warnings = [...missingCols];
  duplicates.forEach((d) => findings.push(F('warn', '실시현황 중복', `같은 현장·구분·본측정일이 중복됩니다: ${d.name} (${d.files.join(' / ')})`)));
  return { ok: true, template: first.template, cols: first.cols, title: opt.title ?? first.title, sites, duplicates, warnings, findings, order: usable.map((f) => f.name) };
}

/** 병합 결과 → SheetJS 워크북 (제목·헤더 서식 복원, 현장별 세로 병합, 날짜/금액 서식) */
export function statusToWorkbook(merged, sheetName = '실시현황') {
  const ws = {};
  const put = (r, c, v, t, z) => { if (v == null || v === '') return; const a = XLSX.utils.encode_cell({ r, c }); ws[a] = { t: t || (typeof v === 'number' ? 'n' : 's'), v }; if (z) ws[a].z = z; };
  const tpl = merged.template;
  for (const x of tpl.cells) {
    let v = x.v;
    if (typeof v === 'string' && /■/.test(v) && merged.title) v = merged.title;
    put(x.r, x.c, v, x.t, x.z);
  }
  const merges = [...tpl.merges];
  const start = tpl.dataStart ?? 1 + Math.max(...tpl.cells.map((x) => x.r), 0);
  let r = start;
  const cols = merged.cols;
  const widthCols = Math.max(tpl.width, ...Object.values(cols).map((c) => c + 1));
  for (const s of merged.sites) {
    const n = Math.max(1, s.items.length);
    const set = (k, v, z) => { if (k in cols) put(r, cols[k], v, typeof v === 'number' ? 'n' : 's', z); };
    set('no', s.no); set('prelim', s.prelim, DATE_Z); set('date', s.date, DATE_Z); set('days', s.days);
    set('name', s.name); set('address', s.address); set('kind', s.kind); set('workers', s.workers);
    set('special', s.special); set('specialHaz', s.specialHaz); set('org', s.org); set('person', s.person);
    set('travel', s.travel, MONEY_Z); set('dep', s.dep, MONEY_Z); set('mat', s.mat, MONEY_Z); set('fee', s.fee, MONEY_Z); set('note', s.note);
    s.items.forEach((it, i) => { if ('eval' in cols) put(r + i, cols.eval, it.eval); if ('hazard' in cols) put(r + i, cols.hazard, it.hazard); });
    if (n > 1) for (let c = 0; c < widthCols; c++) if (c !== cols.eval && c !== cols.hazard && Object.values(cols).includes(c)) merges.push({ s: { r, c }, e: { r: r + n - 1, c } });
    r += n;
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, start), c: widthCols - 1 } });
  ws['!merges'] = merges;
  if (tpl.colWidths?.some(Boolean)) ws['!cols'] = tpl.colWidths.map((w) => w || undefined);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}
