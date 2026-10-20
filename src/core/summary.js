/** 기관별 오류 요약: 어느 기관이 올린 어떤 현장의 무엇이 오류인지 */
import { countSeverity } from './history.js';
import { groupFindings, SEV_LABEL } from './findings-table.js';

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

/** 요약 시트용 행 (분류별): 기간 | 기관 | 현장 | 분류 | 심각도 | 내용 | 사유·상세 | 위치·파일 | 곳수 | 리비전 */
export function summaryRows(project, { header = true } = {}) {
  const rows = header ? [['기간', '기관', '현장', '분류', '심각도', '내용', '사유·상세', '위치·파일', '곳수', '리비전']] : [];
  for (const sub of project.submissions) {
    const rev = currentRev(sub), tail = [`r${rev.n}`];
    const bySite = new Map();
    for (const f of rev.review?.findings || []) if (f.severity !== 'info') (bySite.get(f.site || '(파일 전체)') || bySite.set(f.site || '(파일 전체)', []).get(f.site || '(파일 전체)')).push(f);
    const sites = [...bySite].map(([site, list]) => ({ site, cats: groupFindings(list) })).sort((a, b) => sum(b.cats, 'error') - sum(a.cats, 'error') || sum(b.cats, 'warn') - sum(a.cats, 'warn'));
    for (const { site, cats } of sites) for (const c of cats) for (const x of c.items) rows.push([project.period, sub.org, site, c.category, SEV_LABEL[x.severity], x.head, x.detail.join('\n'), x.spots.join('\n'), x.spots.length || '', ...tail]);
    const decided = new Set((project.decisions || []).filter((d) => d.submissionId === sub.id).map((d) => d.key));
    for (const m of rev.review?.missing || []) rows.push([project.period, sub.org, m.site, `누락 · ${m.kind}`, '누락', m.site, [m.detail, decided.has(missingKey(m)) ? '(응답함)' : '(미응답)'].join(' '), '', '', ...tail]);
  }
  return rows;
}
const sum = (cats, k) => cats.reduce((a, c) => a + c[k], 0);

/** 분류별 요약 시트용 행: 분류 | 오류 | 주의 | 기관 수 | 현장 수 | 누락(미응답) */
export function categoryRows(projects) {
  const by = new Map();
  for (const p of projects) for (const sub of p.submissions) {
    const rev = currentRev(sub);
    for (const f of rev.review?.findings || []) {
      if (f.severity === 'info') continue;
      const c = by.get(f.category) || by.set(f.category, { error: 0, warn: 0, orgs: new Set(), sites: new Set() }).get(f.category);
      c[f.severity]++; c.orgs.add(sub.org); c.sites.add(`${sub.org}|${f.site || ''}`);
    }
  }
  const rows = [['분류', '오류', '주의', '기관 수', '현장 수']];
  for (const [name, c] of [...by].sort((a, b) => b[1].error - a[1].error || b[1].warn - a[1].warn || a[0].localeCompare(b[0], 'ko'))) rows.push([name, c.error, c.warn, c.orgs.size, c.sites.size]);
  return rows;
}
