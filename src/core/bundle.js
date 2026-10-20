/** 최종 산출물 ZIP: 건설사별 폴더에 취합 실시현황·취합 사용실태·결과서·견적서·검토요약을 담는다 */
import JSZip from 'jszip';
import { XLSX } from './xlsx.js';
import { mergeStatus, statusToWorkbook, siteKey } from './status.js';
import { usageToWorkbook, orderUsage } from './usage.js';
import { summarizeProject, summaryRows, categoryRows, currentRev } from './summary.js';
import { buildReportXlsx, head, detailSheet, categorySheet, PALETTE } from './xlsx-report.js';
import { COMPANY_LABEL } from './workspace.js';

const safe = (s, max = 70) => String(s ?? '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || '_';
const ext = (name) => (name.match(/\.[A-Za-z0-9]+$/) || [''])[0];
const aoaSheet = (rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map((w) => ({ wch: w })); return ws; };
const pad = (n, w = 3) => String(n).padStart(w, '0');

const EVENT_LABEL = { create: '작업 시작', submit: '기관 업로드', revise: '수정본', decision: '누락 응답', finalize: '확정', reopen: '확정 해제', order: '취합 순서', merge: '취합', download: '다운로드' };

/** 검토요약 엑셀(서식·색 구분 포함) → Uint8Array */
async function summaryXlsx(projects) {
  const orgRows = [];
  for (const p of projects) for (const s of summarizeProject(p)) orgRows.push([p.title, s.org, `r${s.rev}/${s.revisions}`, s.status === 'finalized' ? '확정' : '진행', s.counts.error, s.counts.warn, s.openMissing, s.sites.length]);
  const org = { name: '기관별 요약', widths: [28, 14, 10, 8, 8, 8, 12, 8], rows: [head(['프로젝트', '기관', '리비전', '상태', '오류', '주의', '누락(미응답)', '현장 수']), ...orgRows.map((r) => r.map((v, i) => {
    if (i === 4 && v > 0) return { v, bold: true, color: PALETTE.error.text, fill: PALETTE.error.strong, h: 'center' };
    if (i === 5 && v > 0) return { v, bold: true, color: PALETTE.warn.text, fill: PALETTE.warn.strong, h: 'center' };
    if (i === 6 && v > 0) return { v, bold: true, color: PALETTE.error.text, fill: PALETTE.error.strong, h: 'center' };
    if (i === 3) return { v, bold: true, fill: v === '확정' ? PALETTE.info.strong : PALETTE.warn.tint, h: 'center' };
    return typeof v === 'number' ? { v, h: 'center' } : v;
  }))] };
  const cat = categoryRows(projects);
  const catSheet = cat.length > 1 ? categorySheet('분류별 요약', cat[0], cat.slice(1), { catCol: 0, countCols: { 1: 'error', 2: 'warn' }, widths: [30, 8, 8, 10, 10] }) : { name: '분류별 요약', rows: [['지적 사항 없음']] };
  const detail = [];
  projects.forEach((p, i) => summaryRows(p, { header: i === 0 }).forEach((r) => detail.push(r)));
  const detSheet = detail.length > 1 ? detailSheet('상세(분류별)', detail[0], detail.slice(1), { catCol: 3, sevCol: 4, widths: [12, 14, 34, 20, 8, 56, 60, 36, 6, 6] }) : { name: '상세(분류별)', rows: [['지적 사항 없음']] };
  const hist = [head(['일시', '작업자', '구분', '내용'])];
  for (const p of projects) for (const e of p.events) hist.push([e.ts, e.by, EVENT_LABEL[e.type] || e.type, e.text || '']);
  const dec = [head(['일시', '작업자', '기관', '누락 항목', '응답', '사유'])];
  for (const p of projects) for (const d of p.decisions || []) dec.push([d.ts, d.by, p.submissions.find((s) => s.id === d.submissionId)?.org || '', d.key, { proceed: '사유 입력 후 진행', hold: '보류', ignore: '무시' }[d.choice], d.reason]);
  return buildReportXlsx([org, catSheet, detSheet, { name: '이력', rows: hist, widths: [24, 12, 12, 100] }, { name: '누락 응답', rows: dec, widths: [24, 12, 14, 50, 16, 40] }]);
}

/**
 * @param {import('./workspace.js').Workspace} ws
 * @param {object[]} projects  같은 건설사의 프로젝트들 (분기=1개, 반기=2개 이상: 앞에서부터 연번 순서)
 * @param {{periodLabel?:string, includeEstimates?:boolean, status?:object}} opt
 * @returns {Promise<{zip:Uint8Array, files:string[], notes:string[]}>}
 */
export async function buildCompanyFolder(ws, projects, zipRoot, opt = {}) {
  const company = projects[0].company, label = COMPANY_LABEL[company] || company;
  const periodLabel = opt.periodLabel || projects.map((p) => p.period).join('+');
  const notes = [];
  // 프로젝트들을 합쳐서 취합
  const statusFiles = [], usage = [], results = [], estimates = [];
  for (const p of projects) { const c = ws.collect(p); statusFiles.push(...c.statusFiles.map((s) => ({ ...s, name: `${p.period} ${s.name}` }))); usage.push(...c.usage); results.push(...c.results.map((r) => ({ ...r, period: p.period }))); estimates.push(...c.estimates.map((e) => ({ ...e, period: p.period }))); }
  const merged = mergeStatus(statusFiles, opt.status || {});
  const folder = zipRoot.folder(label);
  const files = [];
  const put = (path, data) => { folder.file(path, data); files.push(`${label}/${path}`); };

  if (merged.ok) {
    put(`실시현황_${label}_${safe(periodLabel)}.xlsx`, XLSX.write(statusToWorkbook(merged), { type: 'array', bookType: 'xlsx' }));
    merged.findings.forEach((f) => notes.push(`${label}: ${f.message}`));
  } else notes.push(`${label}: 취합할 실시현황이 없습니다.`);

  const siteNames = (merged.sites || []).map((s) => s.name);
  const noOf = (site) => { const k = siteKey(site); const m = (merged.sites || []).find((s) => { const o = siteKey(s.name); return o && k && (o === k || o.includes(k) || k.includes(o)); }); return m?.no ?? null; };
  put(`사용실태_${label}_${safe(periodLabel)}.xlsx`, XLSX.write(usageToWorkbook(orderUsage(usage, siteNames), `${label} ${periodLabel} 사용실태 취합`), { type: 'array', bookType: 'xlsx' }));

  // 결과서: 실시현황 연번 순서 (연번을 못 찾으면 맨 뒤)
  let seq = 0;
  const sortedResults = [...results].sort((a, b) => (noOf(a.site || '') ?? 1e9) - (noOf(b.site || '') ?? 1e9));
  const used = new Set();
  for (const r of sortedResults) {
    const buf = await ws.store.getBlob(r.hash);
    if (!buf) { notes.push(`${label}: 결과서 파일을 찾을 수 없어 제외했습니다 — ${r.name}`); continue; }
    const no = noOf(r.site || '');
    let name = `${no != null ? pad(no) : 'x' + pad(++seq)}_${safe(r.site || r.name.replace(/\.[^.]+$/, ''))}${ext(r.name)}`;
    while (used.has(name)) name = name.replace(/(\.[^.]+)$/, `_${r.org}$1`);
    used.add(name);
    put(`결과서/${name}`, buf);
    if (no == null) notes.push(`${label}: 결과서 '${r.name}' 의 현장을 실시현황에서 찾지 못해 연번 없이 담았습니다.`);
  }
  if (opt.includeEstimates !== false) for (const e of estimates) {
    const buf = await ws.store.getBlob(e.hash);
    if (buf) put(`견적서/${safe(e.org)}/${safe(e.name, 120)}`, buf);
  }
  folder.file(`검토요약_${label}_${safe(periodLabel)}.xlsx`, await summaryXlsx(projects));
  files.push(`${label}/검토요약_${label}_${safe(periodLabel)}.xlsx`);
  return { files, notes, merged };
}

/**
 * 회사별 프로젝트 묶음들을 하나의 ZIP 으로. groups: [[project...], [project...]] (건설사 한 곳당 한 묶음)
 */
export async function buildBundle(ws, groups, opt = {}) {
  const periodLabel = opt.periodLabel || groups.flat().map((p) => p.period).filter((v, i, a) => a.indexOf(v) === i).join('+');
  const zip = new JSZip();
  const root = zip.folder(safe(periodLabel));
  const files = [], notes = [];
  for (const g of groups) { const r = await buildCompanyFolder(ws, g, root, { ...opt, periodLabel: opt.periodLabel || g.map((p) => p.period).join('+') }); files.push(...r.files); notes.push(...r.notes); }
  if (notes.length) root.file('취합_안내.txt', notes.join('\n') + '\n');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { zip: bytes, files: files.map((f) => `${safe(periodLabel)}/${f}`), notes };
}

export { summaryXlsx };
