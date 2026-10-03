/**
 * 분기 작업 흐름: 기관 업로드 → 검토 → (누락 알림·수정본) → 이력 → 확정 → 취합.
 * 저장소(store)는 MemoryStore / IdbStore / HttpStore 중 아무거나 쓴다.
 */
import { XLSX } from './xlsx.js';
import { sha256, textBytes, updateProject } from '../store/index.js';
import { classifyByNames, classifyPdfText, reviewBatch, detectOrg } from './batch.js';
import { parseHyundai, parseSubmission } from './hyundai.js';
import { parseResultText } from './result-pdf.js';
import { parseResult } from './parsers.js';
import { parseEstimatePdf } from './estimate-pdf.js';
import { siteKey, mergeStatus, statusToWorkbook, parseStatus } from './status.js';
import { usageRowsOf, orderUsage, usageToWorkbook } from './usage.js';
import { diffFindings, diffFiles, countSeverity } from './history.js';
import { summarizeProject, currentRev, latestRev, missingKey, summaryRows } from './summary.js';
import { mergeConfig } from './config.js';
import { loadWorkbook } from './read.js';

export const COMPANY_LABEL = { hyundai: '현대건설', gyeryong: '계룡건설', hanwha: '한화건설' };
export const projectId = (company, period) => `${company}__${String(period).trim().replace(/[\\/:*?"<>|\s]+/g, '-')}`;
const isoNow = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
const compact = (f) => ({ severity: f.severity, category: f.category, message: f.message, where: f.where || '', site: f.site || '', file: f.file || '' });

export class Workspace {
  /**
   * @param {{store, user?:string, pdfToText?:(buf:ArrayBuffer)=>Promise<string>, cfg?:object, now?:()=>string}} o
   */
  constructor({ store, user = '', pdfToText, cfg, now = isoNow } = {}) {
    if (!store) throw new Error('Workspace: store 가 필요합니다.');
    this.store = store; this.user = user; this.pdfToText = pdfToText; this.cfg = mergeConfig(cfg); this.now = now;
  }
  setUser(u) { this.user = u; }
  setConfig(cfg) { this.cfg = mergeConfig(cfg); }

  // ── 파일 준비: 해시·역할·식별자(현장) 계산
  async prepareFile({ name, data }) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const p = { name, size: bytes.length, data: bytes, hash: await sha256(bytes) };
    if (/\.pdf$/i.test(name)) {
      if (!this.pdfToText) throw new Error('PDF 를 읽을 수 없습니다 (pdfToText 미설정).');
      p.text = await this.pdfToText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      p.role = classifyPdfText(p.text);
      if (p.role === 'result-pdf') { const r = parseResultText(p.text, name); p.identity = `r|${siteKey(r.cover.site)}|${r.cover.period || ''}|${r.cover.date || ''}`; p.site = r.cover.site; }
      else if (p.role === 'estimate-pdf') { const e = parseEstimatePdf(p.text, name); p.identity = `e|${e.gap.total}`; p.site = e.site; }
      p.textHash = await sha256(textBytes(p.text));
      if (p.role === 'estimate-pdf') p.orgHint = (parseEstimatePdf(p.text, name).issuer || '').replace(/^\(사\)\s*대한산업보건협회\s*/, '').trim();
    } else {
      const names = XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames;
      p.role = classifyByNames(names);
      p.wb = loadWorkbook(bytes, { select: p.role === 'hyundai-estimate' ? 'hyundai' : 'all', type: 'array' });
      if (p.role === 'hyundai-estimate') { const e = parseHyundai(p.wb); p.site = e.siteName; p.identity = `h|${siteKey(e.siteName)}|${e.period || ''}`; }
      else if (p.role === 'hyundai-submission') { const s = parseSubmission(p.wb); p.site = s.status?.site || ''; p.identity = `s|${siteKey(p.site) || name}`; }
      else if (p.role === 'result-xlsx') { const r = parseResult(p.wb, this.cfg, name); p.identity = `rx|${siteKey(r.cover?.site) || name}`; p.site = r.cover?.site; }
      else p.identity = `${p.role}|${name}`; // 산출근거·실시현황: 기관당 하나라고 보고 이름으로 구분
      if (['status', 'unitprice-estimate', 'hyundai-submission'].includes(p.role)) { try { p.orgHint = parseStatus(p.wb, name).sites.map((x) => x.org).find(Boolean) || ''; } catch { p.orgHint = ''; } }
      if (p.role === 'unitprice-estimate' || p.role === 'status') p.identity = p.role; // 같은 역할은 수정본이 교체
    }
    return p;
  }

  /** 저장된 파일 → reviewBatch 입력 형태 */
  async materialize(meta, prepared) {
    if (prepared?.wb || prepared?.text) return { name: meta.name, role: meta.role, wb: prepared.wb, text: prepared.text };
    const buf = await this.store.getBlob(meta.hash);
    if (!buf) throw new Error(`저장된 파일을 찾을 수 없습니다: ${meta.name}`);
    if (meta.textHash) { const t = await this.store.getBlob(meta.textHash); return { name: meta.name, role: meta.role, text: new TextDecoder().decode(new Uint8Array(t)) }; }
    return { name: meta.name, role: meta.role, wb: loadWorkbook(new Uint8Array(buf), { select: meta.role === 'hyundai-estimate' ? 'hyundai' : 'all', type: 'array' }) };
  }

  async _persistFiles(prepared) {
    const metas = [];
    for (const p of prepared) {
      await this.store.putBlob(p.hash, p.data);
      if (p.textHash) await this.store.putBlob(p.textHash, textBytes(p.text));
      metas.push({ name: p.name, role: p.role, identity: p.identity || p.name, size: p.size, hash: p.hash, ...(p.textHash ? { textHash: p.textHash } : {}), ...(p.site ? { site: p.site } : {}) });
    }
    return metas;
  }

  /** 검토 실행 → 리비전에 저장할 요약 */
  async review(company, metas, prepared = [], mode = 'quarter') {
    const byHash = new Map(prepared.map((p) => [p.hash, p]));
    const files = [];
    for (const m of metas) files.push(await this.materialize(m, byHash.get(m.hash)));
    const batch = reviewBatch({ company, mode, files, cfg: this.cfg });
    const usage = batch.results.flatMap((r) => usageRowsOf(r, { org: '' }));
    return {
      mode, at: this.now(), stats: batch.stats, detectedOrg: batch.detectedOrg,
      findings: batch.findings.map(compact), missing: batch.missing, skipped: batch.skipped,
      statuses: batch.statuses.filter((s) => s.ok).map((s) => ({ file: s.file, title: s.title, cols: s.cols, template: s.template, sites: s.sites, dataStart: s.dataStart })),
      usage,
      sites: batch.sites.map((s) => ({ name: s.name, files: s.files })),
    };
  }

  _event(project, e) { project.events.push({ ts: this.now(), by: this.user || '(이름 없음)', ...e }); }

  async openProject(company, period, { mode = 'quarter' } = {}) {
    const id = projectId(company, period);
    return updateProject(this.store, id, (p) => {
      if (p) return null; // 이미 있으면 그대로
      const np = { id, company, period: String(period).trim(), title: `${COMPANY_LABEL[company] || company} ${period}`, createdAt: this.now(), updatedAt: this.now(), mode, submissions: [], events: [], decisions: [], statusOrder: [] };
      this._event(np, { type: 'create', text: `${np.title} 작업을 시작했습니다.` });
      return np;
    });
  }

  /** 기관의 첫 업로드 (같은 기관이 이미 있으면 수정본으로 처리) */
  async submit(projectIdStr, { org, files, note = '', mode }) {
    const prepared = files;
    const metas = await this._persistFiles(prepared);
    const proj0 = await this.store.getProject(projectIdStr);
    if (!proj0) throw new Error('작업을 찾을 수 없습니다.');
    const existing = proj0.submissions.find((s) => s.org === org);
    if (existing) return this.revise(projectIdStr, existing.id, { files: prepared, note: note || '추가 업로드' });
    const useMode = mode || proj0.mode || 'quarter';
    const review = await this.review(proj0.company, metas, prepared, useMode);
    let created;
    const saved = await updateProject(this.store, projectIdStr, (p) => {
      if (p.submissions.some((s) => s.org === org)) throw new Error(`'${org}' 기관이 방금 다른 사용자에 의해 등록되었습니다. 새로고침 후 수정본으로 올려 주세요.`);
      created = { id: `s${p.submissions.length + 1}-${Date.now().toString(36)}`, org, createdAt: this.now(), createdBy: this.user || '', status: 'open', revisions: [{ n: 1, at: this.now(), by: this.user || '', note, files: metas, review }] };
      p.submissions.push(created); p.statusOrder = [...(p.statusOrder || []), created.id]; p.updatedAt = this.now();
      this._event(p, { type: 'submit', submissionId: created.id, rev: 1, text: `${org} 업로드 (${metas.length}개 파일) — 오류 ${countSeverity(review.findings).error}, 주의 ${countSeverity(review.findings).warn}, 누락 ${review.missing.length}` });
      return p;
    });
    return { project: saved, submission: saved.submissions.find((s) => s.id === created.id), review };
  }

  /** 수정본: 이전 리비전 파일 위에 올린 파일을 덮어쓴다(같은 역할·같은 현장이면 교체, 아니면 추가). removeIdentities 로 파일 제거도 가능 */
  async revise(projectIdStr, submissionId, { files = [], note = '', remove = [] }) {
    const metasNew = await this._persistFiles(files);
    const proj0 = await this.store.getProject(projectIdStr);
    const sub0 = proj0?.submissions.find((s) => s.id === submissionId);
    if (!sub0) throw new Error('기관 업로드를 찾을 수 없습니다.');
    const prev = latestRev(sub0);
    const keyOf = (m) => `${m.role}|${m.identity}`;
    const replaced = [];
    let merged = prev.files.filter((m) => !remove.includes(keyOf(m)) && !remove.includes(m.name));
    for (const nm of metasNew) {
      const i = merged.findIndex((m) => keyOf(m) === keyOf(nm));
      if (i >= 0) { replaced.push({ from: merged[i].name, to: nm.name }); merged[i] = nm; } else merged.push(nm);
    }
    const review = await this.review(proj0.company, merged, files, sub0.revisions[0].review?.mode || proj0.mode || 'quarter');
    const diff = diffFindings(prev.review?.findings || [], review.findings);
    let n;
    const saved = await updateProject(this.store, projectIdStr, (p) => {
      const sub = p.submissions.find((s) => s.id === submissionId);
      n = sub.revisions.length + 1;
      sub.revisions.push({ n, at: this.now(), by: this.user || '', note, files: merged, replaced, removed: remove, review, diffFromPrev: diff.counts });
      if (sub.status === 'finalized') { sub.status = 'open'; delete sub.finalizedRev; }
      p.updatedAt = this.now();
      this._event(p, { type: 'revise', submissionId, rev: n, text: `${sub.org} 수정본 r${n} — 해결 ${diff.counts.resolved}, 남음 ${diff.counts.remaining}, 새로 ${diff.counts.introduced}${replaced.length ? ` (교체 ${replaced.length}개)` : ''}` });
      return p;
    });
    return { project: saved, submission: saved.submissions.find((s) => s.id === submissionId), review, diff, rev: n };
  }

  async decide(projectIdStr, submissionId, { key, choice, reason = '' }) {
    if (!['proceed', 'hold', 'ignore'].includes(choice)) throw new Error('선택값이 올바르지 않습니다.');
    return updateProject(this.store, projectIdStr, (p) => {
      p.decisions = (p.decisions || []).filter((d) => !(d.submissionId === submissionId && d.key === key));
      p.decisions.push({ ts: this.now(), by: this.user || '', submissionId, key, choice, reason });
      this._event(p, { type: 'decision', submissionId, text: `누락 알림 응답: ${key} → ${{ proceed: '사유 입력 후 진행', hold: '보류(수정본 요청)', ignore: '무시' }[choice]}${reason ? ` (${reason})` : ''}` });
      return p;
    });
  }

  /** 확정: 오류 0건·미응답 누락 0건이어야 한다. force 면 사유를 남기고 확정 */
  async finalize(projectIdStr, submissionId, { force = false, reason = '' } = {}) {
    const p0 = await this.store.getProject(projectIdStr);
    const s = summarizeProject(p0).find((x) => x.submissionId === submissionId);
    const blockers = [];
    if (s.counts.error) blockers.push(`오류 ${s.counts.error}건이 남아 있습니다.`);
    if (s.openMissing) blockers.push(`응답하지 않은 누락 알림 ${s.openMissing}건이 있습니다.`);
    if (blockers.length && !(force && reason.trim())) return { ok: false, blockers };
    const saved = await updateProject(this.store, projectIdStr, (p) => {
      const sub = p.submissions.find((x) => x.id === submissionId);
      sub.status = 'finalized'; sub.finalizedRev = latestRev(sub).n; sub.finalizedAt = this.now(); sub.finalizedBy = this.user || '';
      if (blockers.length) sub.forcedReason = reason; else delete sub.forcedReason;
      p.updatedAt = this.now();
      this._event(p, { type: 'finalize', submissionId, rev: sub.finalizedRev, text: `${sub.org} r${sub.finalizedRev} 최종 확정${blockers.length ? ` (예외 확정: ${reason})` : ''}` });
      return p;
    });
    return { ok: true, project: saved, forced: blockers.length > 0, blockers };
  }

  async reopen(projectIdStr, submissionId) {
    return updateProject(this.store, projectIdStr, (p) => {
      const sub = p.submissions.find((x) => x.id === submissionId);
      sub.status = 'open'; delete sub.finalizedRev;
      this._event(p, { type: 'reopen', submissionId, text: `${sub.org} 확정을 해제했습니다.` });
      return p;
    });
  }

  async moveStatusOrder(projectIdStr, submissionId, dir) {
    return updateProject(this.store, projectIdStr, (p) => {
      const order = [...new Set([...(p.statusOrder || []), ...p.submissions.map((s) => s.id)])].filter((id) => p.submissions.some((s) => s.id === id));
      const i = order.indexOf(submissionId), j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return null;
      [order[i], order[j]] = [order[j], order[i]];
      p.statusOrder = order;
      this._event(p, { type: 'order', text: `실시현황 취합 순서 변경: ${p.submissions.find((s) => s.id === submissionId).org} ${dir < 0 ? '↑' : '↓'}` });
      return p;
    });
  }

  compareRevisions(sub, aN, bN) {
    const a = sub.revisions.find((r) => r.n === aN), b = sub.revisions.find((r) => r.n === bN);
    return { findings: diffFindings(a.review?.findings || [], b.review?.findings || []), files: diffFiles(a.files, b.files), from: a, to: b };
  }

  // ── 취합
  /** 확정된(없으면 최신) 리비전의 실시현황·사용실태·결과서를 기관 순서대로 모은다 */
  collect(project) {
    const order = [...new Set([...(project.statusOrder || []), ...project.submissions.map((s) => s.id)])].filter((id) => project.submissions.some((s) => s.id === id));
    const subs = order.map((id) => project.submissions.find((s) => s.id === id));
    const statusFiles = [], usage = [], results = [], estimates = [];
    for (const sub of subs) {
      const rev = currentRev(sub);
      for (const st of rev.review?.statuses || []) statusFiles.push({ name: `${sub.org} · ${st.file}`, org: sub.org, parsed: { ok: true, ...st } });
      for (const u of rev.review?.usage || []) usage.push({ ...u, org: sub.org });
      for (const f of rev.files) {
        if (f.role === 'result-pdf' || f.role === 'result-xlsx') results.push({ ...f, org: sub.org, submissionId: sub.id });
        else if (['hyundai-estimate', 'hyundai-submission', 'unitprice-estimate', 'estimate-pdf'].includes(f.role)) estimates.push({ ...f, org: sub.org });
      }
    }
    return { subs, statusFiles, usage, results, estimates };
  }

  buildStatus(project, opt = {}) {
    const c = this.collect(project);
    const merged = mergeStatus(c.statusFiles, opt);
    return { ...c, merged };
  }

  /** 최종 산출물(취합 실시현황, 취합 사용실태, 결과서 매칭) 계산 */
  assemble(project, opt = {}) {
    const { merged, usage, results, estimates, subs } = this.buildStatus(project, opt);
    const siteNames = (merged.sites || []).map((s) => s.name);
    const noOf = (site) => { const k = siteKey(site); const m = (merged.sites || []).find((s) => { const o = siteKey(s.name); return o && k && (o === k || o.includes(k) || k.includes(o)); }); return m?.no ?? null; };
    return { merged, usage: orderUsage(usage, siteNames), results: results.map((r) => ({ ...r, no: noOf(r.site || '') })), estimates, subs, noOf };
  }

  async exportStatusXlsx(project, opt = {}) {
    const { merged } = this.buildStatus(project, opt);
    if (!merged.ok) throw new Error('취합할 실시현황이 없습니다.');
    return { bytes: XLSX.write(statusToWorkbook(merged), { type: 'array', bookType: 'xlsx' }), merged };
  }
}

export { summarizeProject, currentRev, latestRev, missingKey, summaryRows, countSeverity, usageToWorkbook, detectOrg };
