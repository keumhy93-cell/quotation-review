/**
 * 단가 등록 화면: 매년 노임단가·재료비단가(현대), 기본관리비·기본단가(계룡·한화)를 연도별로 올려 등록한다.
 * 올리는 방법: ① 견적 엑셀에서 자동 추출  ② 양식 엑셀(내려받아 채워 올리기)
 * 등록한 단가표는 작업 기간의 연도에 맞춰 검토에 자동 적용되고, 등록·변경은 이력에 남는다.
 */
import { XLSX } from '../src/core/xlsx.js';
import { COMPANY_NAME, GRADES, PERIODS, extractHyundai, extractUnitPrice, mergeCompany, parseTemplate, summarizeYear, templateWorkbook } from '../src/core/pricebook.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function mountPrices(root, { ws, loadWorkbook }) {
  const ui = { year: String(new Date().getFullYear()), book: { years: {}, events: [] }, busy: false, msg: '', msgKind: '', open: new Set(), q: '' };
  const $ = (s) => root.querySelector(s);
  const toast = (m, k = '') => { ui.msg = m; ui.msgKind = k; const e = $('[data-p="msg"]'); if (e) { e.textContent = m; e.className = 'qr-msg ' + k; } };
  const busy = async (label, fn) => { if (ui.busy) return; ui.busy = true; toast(label + '…'); try { return await fn(); } catch (e) { console.error(e); toast('오류: ' + (e?.message || e), 'err'); } finally { ui.busy = false; } };

  function modal(html) {
    const back = document.createElement('div'); back.className = 'qr-modal-back';
    back.innerHTML = `<div class="qr-modal wide" role="dialog" aria-modal="true">${html}</div>`; root.appendChild(back);
    return { el: back.firstElementChild, close: () => back.remove() };
  }
  const download = (wb, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  async function reload() {
    ui.book = await ws.getPriceBook();
    const years = Object.keys(ui.book.years).sort();
    if (!ui.yearTouched && years.length && !years.includes(ui.year)) ui.year = years[years.length - 1];
    render();
  }

  const chip = (ok, text) => `<span class="qr-badge ${ok ? 'info' : 'warn'}">${ok ? '✔' : '미등록'} ${esc(text)}</span>`;
  function companyCard(c, y) {
    const sm = summarizeYear(y)[c], d = y[c] || {};
    const open = ui.open.has(c);
    let status, detail = '', actions;
    if (c === 'hyundai') {
      status = [...PERIODS.map((p) => chip(sm.wage.includes(p), `노임단가 ${p}`)), ...PERIODS.map((p) => chip(sm.factor.includes(p), `계수 ${p}${d.factor?.[p] != null ? ' ×' + d.factor[p] : ''}`)), chip(sm.material > 0, `재료비단가 ${sm.material}종`), chip(sm.rates, `요율${sm.rates ? ` (출장 ${d.travelRate} · 감가 ${d.depRate})` : ''}`)].join(' ');
      if (open) {
        const names = Object.keys(d.material || {}).filter((n) => !ui.q || n.includes(ui.q)).slice(0, 40);
        detail = `<table><thead><tr><th>구분</th>${GRADES.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody>${PERIODS.map((p) => `<tr><td>${p}</td>${GRADES.map((g) => `<td>${won(d.wage?.[p]?.[g])}</td>`).join('')}</tr>`).join('')}</tbody></table>
          ${sm.material ? `<div class="qr-row"><label>재료비단가 검색 <input type="text" data-p="q" value="${esc(ui.q)}" placeholder="유해인자 이름 일부"></label><span class="qr-mute">${names.length}건 표시 (최대 40)</span></div>
          <table><thead><tr><th>유해인자</th><th>측정</th><th>분석(개별)</th><th>분석(중복)</th><th>계</th><th>수정재료비</th><th>시약·소모품</th></tr></thead><tbody>${names.map((n) => `<tr><td>${esc(n)}</td>${d.material[n].map((v) => `<td class="nw">${won(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}`;
      }
      actions = `<label class="qr-drop" style="min-height:0;padding:6px 12px;border-style:solid"><span style="color:inherit"><b>견적 엑셀에서 가져오기</b> <small>(정기·수시 파일을 함께 선택)</small></span><input type="file" multiple data-p="hy-file" accept=".xlsx,.xlsm,.xls"></label>`;
    } else {
      status = [chip(sm.base > 0, `기본관리비 ${sm.base}구간`), chip(sm.methods > 0, `기본단가 ${sm.methods}종`)].join(' ');
      if (open) detail = `<table><thead><tr><th>규모</th><th>기본관리비</th></tr></thead><tbody>${(d.base || []).map((b) => `<tr><td>${esc(b.label)}</td><td class="nw">${won(b.price)}</td></tr>`).join('')}</tbody></table>
        <table><thead><tr><th>분석 규격</th><th>기본단가</th></tr></thead><tbody>${Object.entries(d.methods || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="nw">${won(v)}</td></tr>`).join('')}</tbody></table>`;
      actions = `<label class="qr-drop" style="min-height:0;padding:6px 12px;border-style:solid"><span style="color:inherit"><b>‘단가’ 시트 엑셀에서 가져오기</b></span><input type="file" data-p="up-file" data-co="${c}" accept=".xlsx,.xlsm,.xls"></label>`;
    }
    const has = !!y[c];
    return `<div class="qr-card"><div class="qr-row between"><h2>${COMPANY_NAME[c]} <small>${c === 'hyundai' ? '노임단가 · 재료비단가 · 계수 · 요율' : '기본관리비 · 기본단가'}</small></h2>
      <div class="qr-row" style="margin:0">${has ? `<button data-pa="toggle" data-co="${c}">${open ? '접기' : '등록값 보기'}</button><button data-pa="remove" data-co="${c}">삭제</button>` : ''}</div></div>
      <div class="qr-row" style="margin-top:0">${status}</div><div class="qr-row">${actions}</div>${detail ? `<div class="qr-body">${detail}</div>` : ''}</div>`;
  }

  function render() {
    const years = Object.keys(ui.book.years).sort();
    const y = ui.book.years[ui.year] || {};
    const hist = [...ui.book.events].reverse().slice(0, 40).map((e) => `<tr><td class="qr-mute nw">${fmtTime(e.ts)}</td><td class="nw">${esc(e.by)}</td><td>${esc(e.text)}</td></tr>`).join('');
    root.querySelector('[data-p="body"]').innerHTML = `
      <div class="qr-card"><h2>연도별 단가 등록</h2>
        <p class="qr-mute">매년 새 단가가 나오면 해당 연도로 올립니다. 검토할 때는 <b>작업 기간의 연도</b>(예: 2026-2분기 → 2026년) 단가표가 자동으로 쓰입니다. 올린 값은 이력에 남고, 같은 연도에 다시 올리면 바뀐 값만 알려 주고 덮어씁니다.</p>
        <div class="qr-row"><label>연도 <input type="number" min="2020" max="2100" step="1" data-p="year" value="${esc(ui.year)}" style="width:100px" list="qr-years"></label><datalist id="qr-years">${years.map((v) => `<option value="${v}">`).join('')}</datalist>
          <span>${years.length ? years.map((v) => `<button class="qr-chip" data-pa="year" data-y="${v}">${v}년</button>`).join('') : '<span class="qr-mute">아직 등록된 연도가 없습니다.</span>'}</span></div>
        <div class="qr-row"><button data-pa="tpl">${ui.year}년 양식 내려받기 (현재 등록값 포함)</button>
          <label class="qr-drop" style="min-height:0;padding:6px 12px;border-style:solid"><span style="color:inherit"><b>양식 엑셀 올리기</b> <small>(시트별로 일부만 채워도 됨)</small></span><input type="file" data-p="tpl-file" accept=".xlsx,.xls"></label>
          <span class="qr-msg ${ui.msgKind}" data-p="msg" role="status">${esc(ui.msg)}</span></div></div>
      ${['hyundai', 'gyeryong', 'hanwha'].map((c) => companyCard(c, y)).join('')}
      <div class="qr-card"><h2>단가 등록 이력 <small>${ui.book.events.length}건</small></h2><div class="qr-body"><table><thead><tr><th>일시</th><th>작업자</th><th>내용</th></tr></thead><tbody>${hist || '<tr><td colspan="3" class="qr-mute">이력이 없습니다.</td></tr>'}</tbody></table></div></div>`;
  }

  /** 미리보기 → 저장 확인. items: [{company, incoming, source, notes[]}] */
  async function confirmRegister(title, items, warnings = []) {
    const year = ui.year;
    const plan = items.map((it) => ({ ...it, ...mergeCompany(it.company, ui.book.years[year]?.[it.company] || {}, it.incoming, it.source) }));
    const total = plan.reduce((a, p) => a + p.changes.length, 0);
    const body = plan.map((p) => `<h4>${COMPANY_NAME[p.company]} — ${esc(p.source)}</h4><ul>${p.changes.length ? p.changes.slice(0, 40).map((c) => `<li>${esc(c)}</li>`).join('') : '<li class="qr-mute">기존 등록값과 같아 바뀌는 것이 없습니다.</li>'}${p.changes.length > 40 ? `<li class="qr-mute">외 ${p.changes.length - 40}건</li>` : ''}</ul>`).join('');
    return new Promise((resolve) => {
      const m = modal(`<h3>${esc(title)} — ${year}년으로 등록합니다</h3>${warnings.length ? `<div class="qr-msg err"><ul>${warnings.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}<div class="qr-modal-body">${body}</div>
        <div class="qr-row" style="justify-content:flex-end"><button data-x="no">취소</button><button class="primary" data-x="ok" ${total ? '' : 'disabled'}>${year}년으로 저장 (${total}건 변경)</button></div>`);
      m.el.querySelector('[data-x="no"]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-x="ok"]').onclick = async () => {
        m.el.querySelector('[data-x="ok"]').disabled = true;
        try { for (const it of items) await ws.registerPrices({ year, company: it.company, incoming: it.incoming, source: it.source }); m.close(); resolve(true); }
        catch (e) { console.error(e); m.el.querySelector('.qr-modal-body').insertAdjacentHTML('afterbegin', `<div class="qr-msg err">저장하지 못했습니다: ${esc(e.message)}</div>`); m.el.querySelector('[data-x="ok"]').disabled = false; }
      };
    });
  }

  async function onHyundaiFiles(files) {
    await busy('견적 엑셀 읽는 중', async () => {
      const items = [], warnings = [], mats = [];
      for (const f of files) {
        try { const e = extractHyundai(loadWorkbook(await f.arrayBuffer(), { select: 'hyundai' }), f.name);
          mats.push({ name: f.name, m: e.material });
          items.push({ company: 'hyundai', source: `${f.name} (${e.period})`, incoming: { wage: { [e.period]: e.wage }, factor: e.factor ? { [e.period]: e.factor } : undefined, material: Object.keys(e.material).length ? e.material : undefined, travelRate: e.travelRate ?? undefined, depRate: e.depRate ?? undefined } });
        } catch (err) { warnings.push(`${f.name}: ${err.message}`); }
      }
      for (let i = 1; i < mats.length; i++) { const a = mats[0].m, b = mats[i].m; const diff = Object.keys(a).filter((k) => b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])).length; if (diff) warnings.push(`${mats[0].name} 와 ${mats[i].name} 의 재료비단가표가 ${diff}종 다릅니다 (나중 파일 값이 저장됩니다).`); }
      if (!items.length) { toast(warnings[0] || '읽을 수 있는 견적서가 없습니다.', 'err'); return; }
      if (await confirmRegister('현대건설 견적 엑셀에서 가져오기', items, warnings)) { await reload(); toast('저장했습니다.', 'ok'); } else toast('');
    });
  }
  async function onUnitFile(company, file) {
    await busy('단가 시트 읽는 중', async () => {
      const e = extractUnitPrice(loadWorkbook(await file.arrayBuffer()), file.name);
      if (await confirmRegister(`${COMPANY_NAME[company]} 기본관리비·기본단가`, [{ company, source: file.name, incoming: { base: e.base, methods: e.methods } }])) { await reload(); toast('저장했습니다.', 'ok'); } else toast('');
    });
  }
  async function onTemplate(file) {
    await busy('양식 읽는 중', async () => {
      const { data, warnings } = parseTemplate(loadWorkbook(await file.arrayBuffer()));
      const items = Object.entries(data).map(([company, incoming]) => ({ company, source: file.name, incoming }));
      if (!items.length) { toast(warnings[0] || '읽을 수 있는 단가가 없습니다.', 'err'); return; }
      if (await confirmRegister('양식 엑셀 올리기', items, warnings)) { await reload(); toast('저장했습니다.', 'ok'); } else toast('');
    });
  }

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-pa]'); if (!b) return;
    const a = b.dataset.pa, c = b.dataset.co;
    try {
      if (a === 'year') { ui.year = b.dataset.y; ui.yearTouched = true; render(); }
      else if (a === 'toggle') { ui.open.has(c) ? ui.open.delete(c) : ui.open.add(c); render(); }
      else if (a === 'tpl') download(templateWorkbook(ui.year, ui.book.years[ui.year] || {}), `단가표_양식_${ui.year}.xlsx`);
      else if (a === 'remove') {
        if (!globalThis.confirm(`${ui.year}년 ${COMPANY_NAME[c]} 단가 등록을 삭제할까요? (이력에는 남습니다)`)) return;
        await busy('삭제 중', async () => { await ws.removePrices({ year: ui.year, company: c }); await reload(); toast('삭제했습니다.', 'ok'); });
      }
    } catch (e) { console.error(e); toast('오류: ' + (e?.message || e), 'err'); }
  });
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.matches('[data-p="year"]')) { ui.year = String(t.value).trim(); ui.yearTouched = true; render(); }
    else if (t.matches('[data-p="hy-file"]')) { const fs = [...t.files]; t.value = ''; if (fs.length) await onHyundaiFiles(fs); }
    else if (t.matches('[data-p="up-file"]')) { const f = t.files[0]; const co = t.dataset.co; t.value = ''; if (f) await onUnitFile(co, f); }
    else if (t.matches('[data-p="tpl-file"]')) { const f = t.files[0]; t.value = ''; if (f) await onTemplate(f); }
  });
  root.addEventListener('input', (ev) => { if (ev.target.matches('[data-p="q"]')) { ui.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = root.querySelector('[data-p="q"]'); q?.focus(); q?.setSelectionRange(pos, pos); } });

  root.innerHTML = '<div data-p="body"></div>';
  reload().catch((e) => { root.innerHTML = `<p class="qr-msg err">단가표를 불러오지 못했습니다: ${esc(e.message || e)}</p>`; });
  return { reload, get year() { return ui.year; } };
}
