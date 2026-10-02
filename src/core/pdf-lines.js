/**
 * pdf.js 텍스트 조각(items)을 줄 단위 텍스트로 복원한다.
 *  - 같은 줄(좌표 key)의 조각을 읽는 방향(pos) 순으로 이어 붙이고, 간격이 크면 공백 3칸(= 열 구분)을 넣는다.
 *  - 협회 결과표는 세로 페이지에 90° 회전된 표가 들어 있어, 조각의 회전각(transform)별로 줄 방향을 바꿔 처리한다.
 * 브라우저(web/pdf-text.js)와 Node(테스트)가 같이 쓴다.
 */
const angleOf = (t) => {
  const deg = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI);
  return deg === 90 ? 90 : deg === -90 || deg === 270 ? 270 : deg === 180 ? 180 : 0;
};
// 회전각별 (줄 key, 줄 안의 위치 pos): key 오름차순이 읽는 순서, pos 오름차순이 글자 순서
const coords = {
  0: (t) => ({ key: -t[5], pos: t[4] }),
  90: (t) => ({ key: t[4], pos: t[5] }),
  270: (t) => ({ key: -t[4], pos: -t[5] }),
  180: (t) => ({ key: t[5], pos: -t[4] }),
};

export function itemsToLines(items, tol = 2.5) {
  const groups = { 0: [], 90: [], 270: [], 180: [] };
  for (const it of items) {
    if (!it.str || !it.str.length) continue;
    const a = angleOf(it.transform);
    const { key, pos } = coords[a](it.transform);
    groups[a].push({ key, pos, w: it.width || 0, s: it.str });
  }
  const out = [];
  for (const a of [0, 90, 270, 180]) {
    const rows = [];
    for (const p of groups[a].sort((x, y) => x.key - y.key)) {
      const row = rows.find((r) => Math.abs(r.key - p.key) <= tol);
      if (row) row.parts.push(p); else rows.push({ key: p.key, parts: [p] });
    }
    for (const r of rows) {
      r.parts.sort((x, y) => x.pos - y.pos);
      let line = '', end = null;
      for (const p of r.parts) {
        if (end != null) {
          const gap = p.pos - end;
          const cw = p.w && p.s.length ? p.w / p.s.length : 5;
          line += gap > cw * 2.2 ? '   ' : gap > cw * 0.35 ? ' ' : '';
        }
        line += p.s; end = p.pos + p.w;
      }
      const t = line.replace(/\s+$/, '');
      if (t.trim()) out.push(t);
    }
  }
  return out;
}
