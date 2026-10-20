/**
 * 서식(색·굵기·줄바꿈·필터·머리글 고정)이 들어간 보고서용 엑셀 작성기.
 * SheetJS 커뮤니티판은 셀 서식을 쓰지 못해서, xlsx 를 직접(JSZip) 만든다. 읽기용 SheetJS 와 별개로 동작한다.
 *   sheets: [{ name, rows:[[cell]], widths?:[문자수], filter?:true, freeze?:true }]
 *   cell  : 값(string|number|null) 또는 { v, bold, color:'RRGGBB', fill:'RRGGBB', wrap, h:'center'|'left'|'right', size }
 */
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

export const PALETTE = {
  headFill: '1F4E8C', headText: 'FFFFFF',
  error: { tint: 'FDECEE', strong: 'F4B9BE', text: '9B1C25' },
  warn: { tint: 'FFF6E3', strong: 'FFD9A0', text: '8A5300' },
  info: { tint: 'EEF3F8', strong: 'C9DCEE', text: '3F5F80' },
  cats: ['DCE9F9', 'E3F3E5', 'FFF1D6', 'F3E1F5', 'DDF3F1', 'EDEFD2', 'E4E4F6', 'F9E4D4'],
  line: 'D5DAE3',
};

function styleBook() {
  const fonts = ['<font><sz val="10"/><name val="Malgun Gothic"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const fontIx = new Map(), fillIx = new Map(), xfIx = new Map();
  const font = (c) => { const k = `${!!c.bold}|${c.color || ''}|${c.size || 10}`; if (!fontIx.has(k)) { fontIx.set(k, fonts.length); fonts.push(`<font>${c.bold ? '<b/>' : ''}<sz val="${c.size || 10}"/>${c.color ? `<color rgb="FF${c.color}"/>` : ''}<name val="Malgun Gothic"/></font>`); } return fontIx.get(k); };
  const fill = (rgb) => { if (!rgb) return 0; if (!fillIx.has(rgb)) { fillIx.set(rgb, fills.length); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`); } return fillIx.get(rgb); };
  const xf = (c) => {
    const k = JSON.stringify([c.bold, c.color, c.size, c.fill, c.wrap, c.h, c.border !== false]);
    if (!xfIx.has(k)) {
      xfIx.set(k, xfs.length);
      xfs.push(`<xf numFmtId="0" fontId="${font(c)}" fillId="${fill(c.fill)}" borderId="${c.border === false ? 0 : 1}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"${c.wrap ? ' wrapText="1"' : ''}${c.h ? ` horizontal="${c.h}"` : ''}/></xf>`);
    }
    return xfIx.get(k);
  };
  const xml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF${PALETTE.line}"/></left><right style="thin"><color rgb="FF${PALETTE.line}"/></right><top style="thin"><color rgb="FF${PALETTE.line}"/></top><bottom style="thin"><color rgb="FF${PALETTE.line}"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xf, xml };
}

/** @returns {Promise<Uint8Array>} */
export async function buildReportXlsx(sheets) {
  const sb = styleBook();
  const zip = new JSZip(); const put = zip.file.bind(zip); zip.file = (n, d) => put(n, d, { createFolders: false });
  const names = sheets.map((s, i) => String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  sheets.forEach((sh, si) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((cell, ci) => {
      const c = cell != null && typeof cell === 'object' ? cell : { v: cell };
      const ref = colName(ci) + (ri + 1), s = sb.xf({ wrap: true, ...c });
      const v = c.v;
      if (v == null || v === '') return `<c r="${ref}" s="${s}"/>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const ncol = Math.max(1, ...sh.rows.map((r) => r.length));
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const view = `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>${sh.freeze !== false && sh.rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`;
    const filter = sh.filter && sh.rows.length > 1 ? `<autoFilter ref="A1:${colName(ncol - 1)}${sh.rows.length}"/>` : '';
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`);
  });
  const defined = sheets.map((sh, i) => (sh.filter && sh.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...sh.rows.map((r) => r.length)) - 1)}$${sh.rows.length}</definedName>` : '')).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', sb.xml());
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ── 보고서 시트 꾸미기 헬퍼
export const head = (labels) => labels.map((v) => ({ v, bold: true, color: PALETTE.headText, fill: PALETTE.headFill, h: 'center' }));
const catColor = () => { const m = new Map(); return (name) => { if (!m.has(name)) m.set(name, PALETTE.cats[m.size % PALETTE.cats.length]); return m.get(name); }; };

/**
 * 분류별 상세 시트: rows 는 detailRows() 결과 [...prefix, 분류, 심각도, 내용, 사유, 위치, 곳수].
 * 행 바탕은 심각도 색(연하게), 분류 칸은 분류마다 다른 색, 심각도 칸은 진한 색.
 */
export function detailSheet(name, headers, rows, { catCol, sevCol, widths }) {
  const color = catColor(), sevKey = { 오류: 'error', 주의: 'warn', 참고: 'info', 누락: 'warn' };
  const body = rows.map((r) => {
    const k = sevKey[r[sevCol]] || 'info', P = PALETTE[k];
    return r.map((v, i) => {
      if (i === catCol) return { v, bold: true, fill: color(v) };
      if (i === sevCol) return { v, bold: true, color: P.text, fill: P.strong, h: 'center' };
      if (i === sevCol + 1) return { v, bold: true, fill: P.tint };
      return { v, fill: P.tint, ...(typeof v === 'number' ? { h: 'center' } : {}) };
    });
  });
  return { name, rows: [head(headers), ...body], widths, filter: true };
}

/** 분류별 요약 시트: 분류 칸 색, 오류·주의·참고 숫자는 0 보다 크면 해당 색 */
export function categorySheet(name, headers, rows, { catCol, countCols, widths }) {
  const color = catColor();
  const body = rows.map((r) => r.map((v, i) => {
    if (i === catCol) return { v, bold: true, fill: color(v) };
    const sev = countCols[i];
    if (sev && Number(v) > 0) return { v, bold: true, color: PALETTE[sev].text, fill: PALETTE[sev].strong, h: 'center' };
    return { v, h: typeof v === 'number' ? 'center' : undefined };
  }));
  return { name, rows: [head(headers), ...body], widths };
}
