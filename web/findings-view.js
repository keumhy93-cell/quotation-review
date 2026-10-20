/** 검토 결과 표시 공통: 분류별로 묶고, 같은 내용은 한 줄로 합치고, 긴 문장은 줄을 나눠 보여 준다 (빠른 검토·분기 작업 요약 공용) */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const SEV = { error: '오류', warn: '주의', info: '참고' };

// 첫 문장은 굵게, ' — ' 뒤의 사유와 '(함께 묶인 인자: …)'·'원인:' 은 줄을 바꿔 작게
export function fmtMsg(m) {
  const [head, ...rest] = String(m).split(' — ');
  const sub = rest.join(' — ').split(/ \/ (?=\[)/).map((x) => x.trim()).filter(Boolean);
  const line = (t) => { // '(함께 묶인 인자: …)' 는 괄호가 중첩될 수 있어 짝을 세어 잘라 낸다
    const tag = '(함께 묶인 인자: ', i = t.indexOf(tag); if (i < 0) return esc(t);
    let d = 1, j = i + tag.length; for (; j < t.length && d; j++) d += t[j] === '(' ? 1 : t[j] === ')' ? -1 : 0;
    return `${esc(t.slice(0, i))}<br><span class="qr-sub2">함께 묶인 인자: ${esc(t.slice(i + tag.length, j - 1))}</span>${esc(t.slice(j))}`;
  };
  const hm = line(head).split(/(?<=\S) \/ (?=\[)/);
  return `<b>${hm.join('<br>')}</b>${sub.length ? `<div class="qr-sub">${sub.map((x) => `<div>${line(x).replace(/^원인: /, '<span class="qr-badge info">원인</span> ')}</div>`).join('')}</div>` : ''}`;
}

/**
 * list: [{severity, category, message, where?, file?}] → { body, chips, catList }
 * 분류는 오류가 많은 순, 같은 심각도·같은 내용은 한 줄(위치만 여러 개).
 */
export function renderCategories(list, { chips: wantChips = true } = {}) {
  const order = { error: 0, warn: 1, info: 2 };
  const cats = new Map();
  for (const f of [...list].sort((a, b) => order[a.severity] - order[b.severity])) {
    if (!cats.has(f.category)) cats.set(f.category, new Map());
    const m = cats.get(f.category), key = f.severity + '|' + f.message;
    if (!m.has(key)) m.set(key, { ...f, spots: [] });
    const spot = [f.where, f.file].filter(Boolean).join(' · '); if (spot) m.get(key).spots.push(spot);
  }
  const catList = [...cats].map(([name, items]) => {
    const its = [...items.values()];
    return { name, its, e: its.filter((x) => x.severity === 'error').length, w: its.filter((x) => x.severity === 'warn').length };
  }).sort((x, y) => (y.e - x.e) || (y.w - x.w) || x.name.localeCompare(y.name, 'ko'));
  const body = catList.map((c) => `<section class="qr-cat"><header><b>${esc(c.name)}</b>${c.e ? `<span class="qr-badge error">오류 ${c.e}</span>` : ''}${c.w ? `<span class="qr-badge warn">주의 ${c.w}</span>` : ''}${!c.e && !c.w ? `<span class="qr-badge info">참고 ${c.its.length}</span>` : ''}</header>
    <ol class="qr-items">${c.its.map((x) => { const spots = [...new Set(x.spots)]; return `<li class="${x.severity}"><span class="qr-badge ${x.severity}">${SEV[x.severity]}</span><div><div class="qr-msg-txt">${fmtMsg(x.message)}${x.spots.length > 1 ? ` <span class="qr-mute">(${x.spots.length}곳)</span>` : ''}</div>${spots.length ? `<div class="where">${spots.slice(0, 6).map(esc).join('<br>')}${spots.length > 6 ? `<br>외 ${spots.length - 6}곳` : ''}</div>` : ''}</div></li>`; }).join('')}</ol></section>`).join('');
  const chips = wantChips && catList.length > 1 ? `<div class="qr-catchips">${catList.map((c) => `<span class="qr-chip2 ${c.e ? 'error' : c.w ? 'warn' : 'info'}">${esc(c.name)} ${c.e + c.w || c.its.length}</span>`).join('')}</div>` : '';
  return { body, chips, catList };
}
