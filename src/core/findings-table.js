/** 검토 결과를 분류별로 정리 (엑셀·화면 공용): 같은 분류끼리 묶고, 같은 내용은 한 줄로 합치고, 긴 문장은 내용/사유로 나눈다 */
const ORDER = { error: 0, warn: 1, info: 2 };
export const SEV_LABEL = { error: '오류', warn: '주의', info: '참고' };

/** '문장 — 사유 / [공종] 사유…' → { head, detail: [사유 줄…] }. '(함께 묶인 인자: …)' 는 사유 줄로 뺀다 */
export function splitMessage(m) {
  const [head, ...rest] = String(m ?? '').split(' — ');
  const detail = rest.join(' — ').split(/ \/ (?=\[)/).map((x) => x.trim()).filter(Boolean);
  const cut = (t) => { // 괄호가 중첩될 수 있어 짝을 세어 자른다
    const tag = '(함께 묶인 인자: ', i = t.indexOf(tag); if (i < 0) return [t, null];
    let d = 1, j = i + tag.length; for (; j < t.length && d; j++) d += t[j] === '(' ? 1 : t[j] === ')' ? -1 : 0;
    return [(t.slice(0, i) + t.slice(j)).trim(), `함께 묶인 인자: ${t.slice(i + tag.length, j - 1)}`];
  };
  const [h, hx] = cut(head);
  const lines = [];
  if (hx) lines.push(hx);
  for (const d of detail) { const [t, x] = cut(d); lines.push(t.startsWith('원인: ') ? t : t); if (x) lines.push(x); }
  return { head: h, detail: lines };
}

/**
 * findings: [{severity, category, message, where?, file?}] → [{ category, error, warn, info, items:[{severity, head, detail, spots}] }]
 * 분류는 오류가 많은 순, 항목은 오류→주의→참고, 같은 심각도·같은 내용은 한 항목(위치만 여러 개).
 */
export function groupFindings(findings, { showInfo = true } = {}) {
  const cats = new Map();
  for (const f of [...findings].filter((x) => showInfo || x.severity !== 'info').sort((a, b) => ORDER[a.severity] - ORDER[b.severity])) {
    const c = cats.get(f.category) || cats.set(f.category, new Map()).get(f.category);
    const key = f.severity + '|' + f.message;
    if (!c.has(key)) c.set(key, { severity: f.severity, ...splitMessage(f.message), spots: [] });
    const spot = [f.where, f.file].filter(Boolean).join(' · '); if (spot) c.get(key).spots.push(spot);
  }
  return [...cats].map(([category, m]) => {
    const items = [...m.values()].map((x) => ({ ...x, spots: [...new Set(x.spots)] }));
    const n = (s) => items.filter((x) => x.severity === s).length;
    return { category, error: n('error'), warn: n('warn'), info: n('info'), items };
  }).sort((a, b) => (b.error - a.error) || (b.warn - a.warn) || a.category.localeCompare(b.category, 'ko'));
}

/** 분류별 상세 행: [...prefix, 분류, 심각도, 내용, 사유·상세, 위치·파일, 곳수] */
export function detailRows(findings, prefix = [], opt) {
  const rows = [];
  for (const c of groupFindings(findings, opt)) for (const x of c.items) rows.push([...prefix, c.category, SEV_LABEL[x.severity], x.head, x.detail.join('\n'), x.spots.join('\n'), x.spots.length || '']);
  return rows;
}
