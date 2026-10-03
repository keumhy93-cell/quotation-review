/** 리비전 간 검토 결과 비교 (수정본이 오류를 실제로 고쳤는지) */
const REAL = (f) => f.severity === 'error' || f.severity === 'warn';
export const findingKey = (f) => `${f.site || ''}|${f.category}|${f.message}`;

export function countSeverity(findings = []) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const f of findings) if (c[f.severity] != null) c[f.severity]++;
  return c;
}

/** prev → next: 해결됨 / 그대로 남음 / 새로 생김 */
export function diffFindings(prev = [], next = []) {
  const a = new Map(prev.filter(REAL).map((f) => [findingKey(f), f]));
  const b = new Map(next.filter(REAL).map((f) => [findingKey(f), f]));
  const resolved = [], remaining = [], introduced = [];
  for (const [k, f] of a) (b.has(k) ? remaining : resolved).push(f);
  for (const [k, f] of b) if (!a.has(k)) introduced.push(f);
  return { resolved, remaining, introduced, counts: { resolved: resolved.length, remaining: remaining.length, introduced: introduced.length } };
}

/** 두 리비전의 파일 목록 비교 */
export function diffFiles(prev = [], next = []) {
  const byId = (l) => new Map(l.map((f) => [`${f.role}|${f.identity || f.name}`, f]));
  const a = byId(prev), b = byId(next);
  const added = [], removed = [], changed = [], same = [];
  for (const [k, f] of b) { const o = a.get(k); if (!o) added.push(f); else if (o.hash !== f.hash) changed.push({ from: o, to: f }); else same.push(f); }
  for (const [k, f] of a) if (!b.has(k)) removed.push(f);
  return { added, removed, changed, same };
}

export const eventText = (e) => `${e.type}${e.text ? ': ' + e.text : ''}`;
