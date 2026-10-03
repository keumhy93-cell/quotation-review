/** 기관별 오류 요약: 어느 기관이 올린 어떤 현장의 무엇이 오류인지 */
import { countSeverity } from './history.js';

export const latestRev = (sub) => sub.revisions[sub.revisions.length - 1];
export const currentRev = (sub) => (sub.status === 'finalized' ? sub.revisions.find((r) => r.n === sub.finalizedRev) || latestRev(sub) : latestRev(sub));

export function summarizeProject(project) {
  return project.submissions.map((sub) => {
    const rev = currentRev(sub);
    const findings = (rev.review?.findings || []).filter((f) => f.severity !== 'info');
    const bySite = new Map();
    for (const f of findings) {
      const site = f.site || '(파일 전체)';
      const s = bySite.get(site) || { site, error: 0, warn: 0, categories: new Map() };
      s[f.severity]++;
      const c = s.categories.get(f.category) || { category: f.category, error: 0, warn: 0, messages: [] };
      c[f.severity]++; c.messages.push({ severity: f.severity, message: f.message, where: f.where, file: f.file });
      s.categories.set(f.category, c); bySite.set(site, s);
    }
    const decided = new Set((project.decisions || []).filter((d) => d.submissionId === sub.id).map((d) => d.key));
    const missing = (rev.review?.missing || []).map((m) => ({ ...m, key: missingKey(m), decided: decided.has(missingKey(m)) }));
    return {
      submissionId: sub.id, org: sub.org, rev: rev.n, revisions: sub.revisions.length, status: sub.status, mode: rev.review?.mode,
      counts: countSeverity(rev.review?.findings), missing, openMissing: missing.filter((m) => !m.decided).length,
      sites: [...bySite.values()].map((s) => ({ ...s, categories: [...s.categories.values()].sort((a, b) => b.error - a.error || b.warn - a.warn) })).sort((a, b) => b.error - a.error || b.warn - a.warn),
    };
  });
}
export const missingKey = (m) => `${m.kind}|${m.site}`;

/** 요약 시트용 행 */
export function summaryRows(project) {
  const rows = [['기관', '현장', '심각도', '분류', '내용', '위치', '파일', '리비전']];
  for (const sub of project.submissions) {
    const rev = currentRev(sub);
    for (const f of rev.review?.findings || []) if (f.severity !== 'info') rows.push([sub.org, f.site || '', f.severity === 'error' ? '오류' : '주의', f.category, f.message, f.where || '', f.file || '', `r${rev.n}`]);
    for (const m of rev.review?.missing || []) rows.push([sub.org, m.site, '누락', m.kind, m.detail, '', '', `r${rev.n}`]);
  }
  return rows;
}
