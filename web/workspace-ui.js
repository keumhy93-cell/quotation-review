/**
 * 분기 작업 화면. 위젯(widget.js)의 '분기 작업' 탭에서 쓴다.
 * 흐름: 작업 열기(건설사+기간) → 기관별 파일 업로드·검토 → 누락 알림 응답 → 오류 요약 → 수정본 → 이력 → 확정 → 취합·ZIP 다운로드
 */
import { Workspace, COMPANY_LABEL, summarizeProject, missingKey } from '../src/core/workspace.js';
import { buildBundle, summaryWorkbook } from '../src/core/bundle.js';
import { statusToWorkbook } from '../src/core/status.js';
import { usageToWorkbook } from '../src/core/usage.js';
import { XLSX } from '../src/core/xlsx.js';
import { IdbStore, HttpStore, MemoryStore } from '../src/store/index.js';
import { ROLES } from '../src/core/batch.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEV = { error: '오류', warn: '주의', info: '참고' };
const EVENT_LABEL = { create: '작업 시작', submit: '기관 업로드', revise: '수정본', decision: '누락 응답', finalize: '확정', reopen: '확정 해제', order: '취합 순서', download: '다운로드' };
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? iso : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

function download(bytes, name, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** 저장소 선택: 서버(공유) → 이 브라우저(IndexedDB) → 메모리 */
export async function pickStore(opts = {}) {
  const s = opts.store;
  if (s && typeof s === 'object') return s;
  if (s === 'idb') return new IdbStore();
  if (s === 'memory') return new MemoryStore();
  const tryServer = async (base, token) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    try { const r = await fetch(base + '/api/health', { signal: ctl.signal, headers: token ? { 'x-token': token } : {} }); return r; } catch { return null; } finally { clearTimeout(t); }
  };
  if (s === 'server' || (!s && /^https?:/.test(location.protocol))) {
    const base = opts.serverUrl || '';
    let token = opts.token || ''; try { token = token || sessionStorage.getItem('qr-token') || ''; } catch { /* 무시 */ }
    let r = await tryServer(base, token);
    if (r && r.status === 401) {
      token = globalThis.prompt?.('공유 서버 접근 토큰을 입력하세요') || '';
      r = await tryServer(base, token);
      if (r?.ok) { try { sessionStorage.setItem('qr-token', token); } catch { /* 무시 */ } }
    }
    if (r?.ok) return new HttpStore(base, { token });
    if (s === 'server') throw new Error('공유 서버에 연결할 수 없습니다.');
  }
  try { if (typeof indexedDB !== 'undefined') { const st = new IdbStore(); await st._open(); return st; } } catch { /* 아래로 */ }
  const m = new MemoryStore(); m.volatile = true; return m;
}

export function mountWorkspace(root, { store, cfg, pdfToText, ensurePdf, loadWorkbook, user = '', onChange }) {
  const ws = new Workspace({ store, user, cfg, pdfToText: async (buf) => { await ensurePdf(); return pdfToText(buf); } });
  const ui = { company: 'hyundai', period: '', mode: 'quarter', project: null, pending: [], busy: false, open: new Set(), recent: [], msg: '', msgKind: '', skipDup: false, selectedHalf: new Set(), includeEstimates: true, preview: null };
  try { ws.setUser(localStorage.getItem('qr-user') || user); } catch { /* 무시 */ }
  const userName = () => ws.user;

  const $ = (sel) => root.querySelector(sel);
  const toast = (msg, kind = '') => { ui.msg = msg; ui.msgKind = kind; const m = $('[data-w="msg"]'); if (m) { m.textContent = msg; m.className = 'qr-msg ' + kind; } };
  const busy = async (label, fn) => {
    if (ui.busy) return; ui.busy = true; toast(label + '…'); renderBusy();
    try { return await fn(); } catch (e) { console.error(e); toast('오류: ' + (e?.message || e), 'err'); } finally { ui.busy = false; renderBusy(); }
  };
  const renderBusy = () => root.querySelectorAll('button[data-act]').forEach((b) => { b.disabled = ui.busy || b.dataset.needs === 'project' && !ui.project; });

  // ── 모달
  function modal(html, { wide = false } = {}) {
    const back = document.createElement('div'); back.className = 'qr-modal-back';
    back.innerHTML = `<div class="qr-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    root.appendChild(back);
    const close = () => back.remove();
    return { el: back.firstElementChild, close, back };
  }
  const confirmBox = (title, body, ok = '계속', cancel = '취소') => new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><div class="qr-modal-body">${body}</div><div class="qr-row" style="justify-content:flex-end"><button data-x="no">${esc(cancel)}</button><button class="primary" data-x="ok">${esc(ok)}</button></div>`);
    m.el.querySelector('[data-x="ok"]').onclick = () => { m.close(); res(true); };
    m.el.querySelector('[data-x="no"]').onclick = () => { m.close(); res(false); };
  });

  // ── 렌더
  function render() {
    const recent = ui.recent.map((p) => `<button class="qr-chip" data-act="open-recent" data-id="${esc(p.id)}">${esc(p.title || p.id)}<small> · ${p.submissions}곳</small></button>`).join('');
    root.querySelector('[data-w="recent"]').innerHTML = recent ? `<div class="qr-mute" style="margin:8px 0 4px">최근 작업</div>${recent}` : '';
    const body = $('[data-w="project"]');
    if (!ui.project) { body.innerHTML = ''; body.hidden = true; return; }
    body.hidden = false;
    const p = ui.project, sums = summarizeProject(p);
    body.innerHTML = `
      ${renderUpload(p)}
      ${renderErrorSummary(p, sums)}
      ${renderSubmissions(p, sums)}
      ${renderAssemble(p)}
      ${renderHistory(p)}`;
    renderBusy();
  }

  function renderUpload(p) {
    const list = ui.pending.map((f, i) => `<tr><td>${esc(f.name)}</td><td><span class="qr-badge ${f.role === 'unknown' ? 'warn' : 'info'}">${esc(ROLES[f.role] || f.role)}</span></td><td class="qr-mute">${esc(f.site || '')}</td><td>${kb(f.size)}</td><td><button data-act="drop-pending" data-i="${i}" title="뺄게요">✕</button></td></tr>`).join('');
    const orgHint = ui.pending.map((f) => f.orgHint).find(Boolean) || '';
    return `<div class="qr-card"><h2>1. 기관 파일 올리기 <small>${esc(p.title)}</small></h2>
      <p class="qr-mute">견적서(엑셀·PDF)·결과서(PDF)·실시현황·사업장 제출용 엑셀을 한꺼번에 올리면 종류를 자동으로 구분합니다. 같은 기관이 다시 올리면 수정본(r2, r3…)으로 쌓이고 이전 결과와 비교합니다.</p>
      <div class="qr-row"><label>기관(센터) <input type="text" data-w="org" placeholder="예: 인천센터" value="${esc(ui.orgInput ?? orgHint)}" list="qr-orgs"></label>
        <datalist id="qr-orgs">${p.submissions.map((s) => `<option value="${esc(s.org)}">`).join('')}</datalist>
        <label class="qr-drop" data-w="drop" style="min-height:0;padding:8px 14px;flex-direction:row;gap:8px"><b>파일 선택·끌어놓기</b><input type="file" multiple data-w="files" accept=".xlsx,.xlsm,.xls,.pdf"></label></div>
      ${ui.pending.length ? `<div class="qr-body"><table><thead><tr><th>파일</th><th>분류</th><th>현장</th><th>크기</th><th></th></tr></thead><tbody>${list}</tbody></table></div>` : ''}
      <div class="qr-row"><button class="primary" data-act="submit" ${ui.pending.length ? '' : 'disabled'}>업로드하고 검토</button><span class="qr-msg ${ui.msgKind}" data-w="msg">${esc(ui.msg)}</span></div></div>`;
  }

  function renderErrorSummary(p, sums) {
    if (!sums.length) return '';
    const rows = sums.map((s) => {
      const open = ui.open.has(s.submissionId);
      const cats = s.sites.flatMap((x) => x.categories.map((c) => ({ ...c, site: x.site }))).sort((a, b) => b.error - a.error).slice(0, 3).map((c) => `${esc(c.category)}(${c.error + c.warn})`).join(', ');
      const detail = open ? `<tr><td colspan="7">${s.sites.map((site) => `<div class="qr-site"><b>${esc(site.site)}</b> ${site.error ? `<span class="qr-badge error">오류 ${site.error}</span>` : ''} ${site.warn ? `<span class="qr-badge warn">주의 ${site.warn}</span>` : ''}
        <ul>${site.categories.map((c) => `<li><b>${esc(c.category)}</b> — ${c.messages.slice(0, 4).map((m) => `<span class="qr-badge ${m.severity}">${SEV[m.severity]}</span> ${esc(m.message)}${m.where ? ` <small>(${esc(m.where)})</small>` : ''}`).join('<br>')}${c.messages.length > 4 ? `<br><small>외 ${c.messages.length - 4}건</small>` : ''}</li>`).join('')}</ul></div>`).join('') || '<span class="qr-mute">오류·주의가 없습니다.</span>'}
        ${s.missing.length ? `<div class="qr-site"><b>누락</b><ul>${s.missing.map((m) => `<li><span class="qr-badge warn">${esc(m.kind)}</span> ${esc(m.site)} <small>${esc(m.detail)}</small> ${m.decided ? '<span class="qr-badge info">응답함</span>' : '<span class="qr-badge error">미응답</span>'}</li>`).join('')}</ul></div>` : ''}</td></tr>` : '';
      return `<tr><td><b>${esc(s.org)}</b></td><td>${s.counts.error ? `<span class="qr-badge error">오류 ${s.counts.error}</span>` : '<span class="qr-badge info">오류 0</span>'}</td><td>${s.counts.warn ? `<span class="qr-badge warn">주의 ${s.counts.warn}</span>` : '0'}</td><td>${s.missing.length ? `<span class="qr-badge ${s.openMissing ? 'error' : 'warn'}">누락 ${s.missing.length}${s.openMissing ? ` (미응답 ${s.openMissing})` : ''}</span>` : '0'}</td><td class="qr-mute">${cats || '-'}</td><td>${s.sites.length}현장</td><td><button data-act="toggle-sum" data-id="${esc(s.submissionId)}">${open ? '접기' : '자세히'}</button></td></tr>${detail}`;
    }).join('');
    const tot = sums.reduce((a, s) => ({ e: a.e + s.counts.error, w: a.w + s.counts.warn, m: a.m + s.openMissing }), { e: 0, w: 0, m: 0 });
    return `<div class="qr-card"><div class="qr-row between"><h2>2. 오류 요약 <small>어느 기관의 어떤 현장이 무엇 때문에 오류인지</small></h2><div class="qr-counts"><span class="qr-pill error">오류 ${tot.e}</span><span class="qr-pill warn">주의 ${tot.w}</span><span class="qr-pill ${tot.m ? 'error' : 'info'}">미응답 누락 ${tot.m}</span></div></div>
      <div class="qr-body"><table><thead><tr><th>기관</th><th>오류</th><th>주의</th><th>누락</th><th>주요 분류</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="qr-row"><button data-act="dl-summary">요약 엑셀 저장</button></div></div>`;
  }

  function renderSubmissions(p, sums) {
    const rows = p.submissions.map((sub) => {
      const s = sums.find((x) => x.submissionId === sub.id);
      const fin = sub.status === 'finalized';
      return `<tr><td><b>${esc(sub.org)}</b></td><td>r${s.rev}<small>/${s.revisions}</small></td><td>${sub.revisions[sub.revisions.length - 1].files.length}개</td><td>${fin ? '<span class="qr-badge info">확정 r' + sub.finalizedRev + '</span>' : '<span class="qr-badge warn">진행 중</span>'}${sub.forcedReason ? `<br><small>예외 확정: ${esc(sub.forcedReason)}</small>` : ''}</td>
        <td><button data-act="revise" data-id="${esc(sub.id)}">수정본 올리기</button> <button data-act="history" data-id="${esc(sub.id)}">이력·비교</button>
        ${s.missing.length ? `<button data-act="alerts" data-id="${esc(sub.id)}">누락 응답</button>` : ''}
        ${fin ? `<button data-act="reopen" data-id="${esc(sub.id)}">확정 해제</button>` : `<button class="primary" data-act="finalize" data-id="${esc(sub.id)}">최종 확정</button>`}</td></tr>`;
    }).join('');
    return `<div class="qr-card"><h2>3. 기관별 업로드·수정본 <small>수정본을 올리면 이전 리비전과 비교해 최종본을 만듭니다</small></h2>
      <div class="qr-body"><table><thead><tr><th>기관</th><th>리비전</th><th>파일</th><th>상태</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="qr-mute">아직 올린 기관이 없습니다.</td></tr>'}</tbody></table></div>
      <input type="file" multiple data-w="revfiles" accept=".xlsx,.xlsm,.xls,.pdf" hidden></div>`;
  }

  function renderAssemble(p) {
    const order = [...new Set([...(p.statusOrder || []), ...p.submissions.map((s) => s.id)])].filter((id) => p.submissions.some((s) => s.id === id));
    let merged; try { merged = ws.buildStatus(p, { skipDuplicates: ui.skipDup }).merged; } catch (e) { merged = { ok: false, sites: [], findings: [], duplicates: [] }; }
    const siteCount = (id) => { const sub = p.submissions.find((s) => s.id === id); const rev = sub.revisions[sub.revisions.length - 1]; return (rev.review?.statuses || []).reduce((a, x) => a + x.sites.length, 0); };
    const orderRows = order.map((id, i) => { const sub = p.submissions.find((s) => s.id === id); return `<tr><td>${i + 1}</td><td>${esc(sub.org)}</td><td>${siteCount(id)}현장</td><td><button data-act="order" data-id="${esc(id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button data-act="order" data-id="${esc(id)}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></td></tr>`; }).join('');
    const dups = merged.duplicates?.length ? `<div class="qr-msg err">같은 현장·구분·본측정일이 ${merged.duplicates.length}건 중복됩니다: ${merged.duplicates.slice(0, 3).map((d) => esc(d.name)).join(', ')}${merged.duplicates.length > 3 ? ' …' : ''} <label class="qr-chk"><input type="checkbox" data-w="skipdup" ${ui.skipDup ? 'checked' : ''}> 중복은 하나만 남기기</label></div>` : '';
    const prev = merged.ok ? `<div class="qr-body"><table><thead><tr><th class="nw">연번</th><th>현장명</th><th class="nw">구분</th><th class="nw">측정기관</th><th class="nw">최종수수료</th><th>출처</th></tr></thead><tbody>${merged.sites.slice(0, ui.preview ? 500 : 6).map((s) => `<tr><td class="nw">${s.no}</td><td>${esc(s.name)}</td><td class="nw">${esc(s.kind)}</td><td class="nw">${esc(s.org)}</td><td class="nw">${s.fee != null ? Number(s.fee).toLocaleString('ko-KR') : ''}</td><td class="qr-mute">${esc(s.from)}</td></tr>`).join('')}</tbody></table>${merged.sites.length > 6 ? `<button data-act="toggle-preview">${ui.preview ? '접기' : `전체 ${merged.sites.length}현장 보기`}</button>` : ''}</div>` : '<div class="qr-mute">취합할 실시현황이 아직 없습니다.</div>';
    const halfOpts = (ui.recent || []).filter((x) => x.company === p.company && x.id !== p.id).map((x) => `<label class="qr-chk"><input type="checkbox" data-w="half" value="${esc(x.id)}" ${ui.selectedHalf.has(x.id) ? 'checked' : ''}> ${esc(x.period)}</label>`).join(' ');
    const others = (ui.recent || []).filter((x) => x.period === p.period && x.company !== p.company).map((x) => `<label class="qr-chk"><input type="checkbox" data-w="allco" value="${esc(x.id)}"> ${esc(COMPANY_LABEL[x.company] || x.company)}</label>`).join(' ');
    return `<div class="qr-card"><h2>4. 취합·다운로드</h2>
      <div class="qr-stack"><div class="qr-cfg-box"><h3>실시현황 연번 순서 <small>(올린 기관 순서대로 1번부터 — ↑↓로 바꾸면 연번이 다시 매겨집니다)</small></h3><table><tbody>${orderRows}</tbody></table></div>
      <div class="qr-cfg-box"><h3>취합 실시현황 미리보기</h3>${dups}${prev}</div></div>
      <div class="qr-row"><label>제목 <input type="text" data-w="stitle" style="min-width:300px" placeholder="비우면 첫 파일의 제목" value="${esc(ui.statusTitle ?? '')}"></label></div>
      <div class="qr-row"><button data-act="dl-status" ${merged.ok ? '' : 'disabled'}>취합 실시현황(xlsx)</button><button data-act="dl-usage">취합 사용실태(xlsx)</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
      <h3>폴더별 최종 ZIP <small>건설사 폴더 안에 취합 실시현황·사용실태·결과서·견적서·검토요약</small></h3>
      <div class="qr-row"><label class="qr-chk"><input type="checkbox" data-w="inc-est" ${ui.includeEstimates ? 'checked' : ''}> 견적서 원본 포함</label></div>
      ${halfOpts ? `<div class="qr-row"><span class="qr-mute">반기 병합(이전 분기 포함):</span> ${halfOpts} <label>반기 이름 <input type="text" data-w="halfname" placeholder="예: 2026-상반기" value="${esc(ui.halfName ?? '')}"></label></div>` : ''}
      ${others ? `<div class="qr-row"><span class="qr-mute">같은 기간의 다른 건설사도 함께:</span> ${others}</div>` : ''}
      <div class="qr-row"><button class="primary" data-act="dl-zip">최종 ZIP 다운로드</button></div></div>`;
  }

  function renderHistory(p) {
    const rows = [...p.events].reverse().slice(0, 60).map((e) => `<tr><td class="qr-mute nw">${fmtTime(e.ts)}</td><td class="nw">${esc(e.by)}</td><td class="nw"><span class="qr-badge info">${esc(EVENT_LABEL[e.type] || e.type)}</span></td><td>${esc(e.text)}</td></tr>`).join('');
    return `<div class="qr-card"><h2>5. 작업 이력 <small>${p.events.length}건</small></h2><div class="qr-body"><table><thead><tr><th>일시</th><th>작업자</th><th>구분</th><th>내용</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // ── 동작
  async function refreshRecent() { try { ui.recent = (await store.listProjects()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); } catch { ui.recent = []; } }
  async function reload() { if (ui.project) ui.project = await store.getProject(ui.project.id); await refreshRecent(); render(); onChange?.(); }

  async function openProject(company, period) {
    if (!period.trim()) { toast('기간을 입력하세요 (예: 2026-2분기).', 'err'); return; }
    await busy('작업 여는 중', async () => {
      ui.company = company; ui.period = period.trim(); ui.pending = []; ui.orgInput = undefined;
      ui.project = null; render(); // 새 작업을 읽는 동안 이전 작업 화면에 잘못 올리지 않도록 비운다
      ui.project = await ws.openProject(company, ui.period, { mode: ui.mode });
      await refreshRecent(); ui.msg = ''; render();
    });
  }

  async function prepareFiles(fileList) {
    await busy('파일 분류 중', async () => {
      const out = [];
      for (const f of fileList) {
        toast(`읽는 중… ${f.name}`);
        try { const p = await ws.prepareFile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); out.push(p); }
        catch (e) { console.error(e); toast(`'${f.name}' 을(를) 읽지 못했습니다: ${e.message}`, 'err'); }
      }
      ui.pending = [...ui.pending, ...out.filter((x) => !ui.pending.some((y) => y.hash === x.hash))];
      const unknown = out.filter((x) => x.role === 'unknown').length;
      toast(unknown ? `${unknown}개 파일은 종류를 알 수 없어 제외됩니다.` : '');
      render();
    });
  }

  /** 누락 알림창: 항목마다 사유 입력 후 진행 / 보류 / 무시 중 하나로 응답받는다 */
  function askMissing(sub, missing, title = '누락 알림') {
    return new Promise((resolve) => {
      if (!missing.length) return resolve(true);
      const rows = missing.map((m, i) => `<div class="qr-miss"><div><span class="qr-badge warn">${esc(m.kind)}</span> <b>${esc(m.site)}</b><br><small>${esc(m.detail)}</small></div>
        <div class="qr-row" style="margin-top:6px"><label class="qr-chk"><input type="radio" name="m${i}" value="proceed" checked> 사유 입력 후 진행</label><label class="qr-chk"><input type="radio" name="m${i}" value="hold"> 보류(수정본 요청)</label><label class="qr-chk"><input type="radio" name="m${i}" value="ignore"> 무시</label>
        <input type="text" data-r="${i}" placeholder="사유(예: 센터에서 결과서 추후 제출)" style="flex:1;min-width:200px"></div></div>`).join('');
      const m = modal(`<h3>${esc(title)}: ${missing.length}건</h3><p class="qr-mute"><b>${esc(sub.org)}</b> 자료에서 누락으로 보이는 항목입니다. 어떻게 처리할지 알려 주세요. 응답은 이력에 남습니다.</p><div class="qr-modal-body">${rows}</div><div class="qr-msg err" data-x="err"></div><div class="qr-row" style="justify-content:flex-end"><button data-x="later">나중에</button><button class="primary" data-x="ok">응답 저장</button></div>`, { wide: true });
      m.el.querySelector('[data-x="later"]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-x="ok"]').onclick = async () => {
        const answers = missing.map((mm, i) => ({ mm, choice: m.el.querySelector(`input[name="m${i}"]:checked`).value, reason: m.el.querySelector(`[data-r="${i}"]`).value.trim() }));
        const bad = answers.find((a) => a.choice === 'proceed' && !a.reason);
        if (bad) { m.el.querySelector('[data-x="err"]').textContent = `'${bad.mm.site}' 은(는) 사유를 입력해야 진행할 수 있습니다.`; return; }
        for (const a of answers) await ws.decide(ui.project.id, sub.id, { key: missingKey(a.mm), choice: a.choice, reason: a.reason });
        m.close(); await reload(); resolve(true);
      };
    });
  }

  function showDiff(sub, diff, rev) {
    const li = (arr) => arr.slice(0, 40).map((f) => `<li><small>${esc(f.site || '')}</small> ${esc(f.category)} — ${esc(f.message)}</li>`).join('') || '<li class="qr-mute">없음</li>';
    const m = modal(`<h3>${esc(sub.org)} r${rev} — 이전 리비전과 비교</h3><div class="qr-counts"><span class="qr-pill ok">해결 ${diff.resolved.length}</span><span class="qr-pill warn">남음 ${diff.remaining.length}</span><span class="qr-pill error">새로 생김 ${diff.introduced.length}</span></div>
      <div class="qr-modal-body"><h4>해결됨</h4><ul>${li(diff.resolved)}</ul><h4>아직 남음</h4><ul>${li(diff.remaining)}</ul><h4>새로 생긴 문제</h4><ul>${li(diff.introduced)}</ul></div><div class="qr-row" style="justify-content:flex-end"><button class="primary" data-x="ok">확인</button></div>`, { wide: true });
    m.el.querySelector('[data-x="ok"]').onclick = m.close;
  }

  async function showHistory(sub) {
    const s = sub.revisions;
    const opts = s.map((r) => `<option value="${r.n}">r${r.n} · ${fmtTime(r.at)} · ${esc(r.by || '')}</option>`).join('');
    const m = modal(`<h3>${esc(sub.org)} 이력·비교</h3><div class="qr-body"><table><thead><tr><th>리비전</th><th>일시</th><th>작업자</th><th>파일</th><th>오류</th><th>주의</th><th>변화</th><th>메모</th></tr></thead><tbody>${s.map((r) => { const c = { e: (r.review?.findings || []).filter((f) => f.severity === 'error').length, w: (r.review?.findings || []).filter((f) => f.severity === 'warn').length }; const d = r.diffFromPrev; return `<tr><td>r${r.n}${sub.finalizedRev === r.n ? ' ✔확정' : ''}</td><td>${fmtTime(r.at)}</td><td>${esc(r.by || '')}</td><td>${r.files.length}개${r.replaced?.length ? `<br><small>교체: ${r.replaced.map((x) => esc(x.from) + '→' + esc(x.to)).join(', ')}</small>` : ''}</td><td>${c.e}</td><td>${c.w}</td><td>${d ? `해결 ${d.resolved} / 남음 ${d.remaining} / 신규 ${d.introduced}` : '-'}</td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</tbody></table></div>
      ${s.length > 1 ? `<div class="qr-row"><label>비교 <select data-x="a">${opts}</select></label> → <select data-x="b">${opts}</select> <button data-x="cmp">비교</button></div><div data-x="out"></div>` : ''}
      <div class="qr-row" style="justify-content:flex-end"><button class="primary" data-x="ok">닫기</button></div>`, { wide: true });
    m.el.querySelector('[data-x="ok"]').onclick = m.close;
    if (s.length > 1) {
      m.el.querySelector('[data-x="a"]').value = String(s.length - 1); m.el.querySelector('[data-x="b"]').value = String(s.length);
      m.el.querySelector('[data-x="cmp"]').onclick = () => {
        const a = Number(m.el.querySelector('[data-x="a"]').value), b = Number(m.el.querySelector('[data-x="b"]').value);
        const d = ws.compareRevisions(sub, a, b);
        const li = (arr) => arr.slice(0, 30).map((f) => `<li><small>${esc(f.site || '')}</small> ${esc(f.category)} — ${esc(f.message)}</li>`).join('') || '<li class="qr-mute">없음</li>';
        m.el.querySelector('[data-x="out"]').innerHTML = `<div class="qr-counts"><span class="qr-pill ok">해결 ${d.findings.resolved.length}</span><span class="qr-pill warn">남음 ${d.findings.remaining.length}</span><span class="qr-pill error">새로 ${d.findings.introduced.length}</span></div>
          <p class="qr-mute">파일: 추가 ${d.files.added.length} · 제거 ${d.files.removed.length} · 변경 ${d.files.changed.length} · 동일 ${d.files.same.length}</p>
          <h4>해결됨</h4><ul>${li(d.findings.resolved)}</ul><h4>새로 생김</h4><ul>${li(d.findings.introduced)}</ul>`;
      };
    }
  }

  async function doSubmit() {
    const org = ($('[data-w="org"]').value || '').trim();
    if (!org) { toast('기관(센터) 이름을 입력하세요.', 'err'); return; }
    const files = ui.pending.filter((f) => f.role !== 'unknown');
    if (!files.length) { toast('검토할 수 있는 파일이 없습니다.', 'err'); return; }
    const exists = ui.project.submissions.find((s) => s.org === org);
    if (exists && !(await confirmBox('이미 올린 기관입니다', `<b>${esc(org)}</b> 기관은 이미 올린 자료가 있습니다. 이번 업로드를 <b>수정본(r${exists.revisions.length + 1})</b>으로 쌓을까요?`, '수정본으로 올리기'))) return;
    let result;
    await busy('검토 중', async () => {
      result = exists ? await ws.revise(ui.project.id, exists.id, { files, note: '수정본 업로드' }) : await ws.submit(ui.project.id, { org, files });
      ui.pending = []; ui.orgInput = undefined; ui.project = result.project; await refreshRecent(); ui.open.add(result.submission.id); toast('검토를 마쳤습니다.', 'ok'); render(); onChange?.();
    });
    if (!result) return;
    if (result.diff) showDiff(result.submission, result.diff, result.rev);
    const sum = summarizeProject(ui.project).find((x) => x.submissionId === result.submission.id);
    const open = sum.missing.filter((m) => !m.decided);
    if (open.length) await askMissing(result.submission, open);
  }

  async function doRevise(subId, fileList) {
    const sub = ui.project.submissions.find((s) => s.id === subId);
    let result;
    await busy('수정본 검토 중', async () => {
      const prepared = [];
      for (const f of fileList) prepared.push(await ws.prepareFile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }));
      const files = prepared.filter((p) => p.role !== 'unknown');
      if (!files.length) throw new Error('검토할 수 있는 파일이 없습니다.');
      result = await ws.revise(ui.project.id, subId, { files, note: '수정본 업로드' });
      ui.project = result.project; await refreshRecent(); toast('수정본을 검토했습니다.', 'ok'); render(); onChange?.();
    });
    if (!result) return;
    showDiff(sub, result.diff, result.rev);
    const sum = summarizeProject(ui.project).find((x) => x.submissionId === subId);
    const open = sum.missing.filter((m) => !m.decided);
    if (open.length) await askMissing(result.submission, open);
  }

  async function doFinalize(subId) {
    const sub = ui.project.submissions.find((s) => s.id === subId);
    await busy('확정 중', async () => {
      let r = await ws.finalize(ui.project.id, subId);
      if (!r.ok) {
        let reason = '';
        const go = await new Promise((res) => {
          const m = modal(`<h3>확정할 수 없습니다</h3><div class="qr-modal-body"><ul>${r.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><p>그래도 <b>예외로 확정</b>하려면 사유를 입력하세요. 사유는 이력과 검토요약에 남습니다.</p><input type="text" data-x="reason" style="width:100%" placeholder="예: 센터와 협의 완료, 다음 분기 보완"></div><div class="qr-row" style="justify-content:flex-end"><button data-x="no">취소(수정본 올리기)</button><button class="primary" data-x="ok">예외 확정</button></div>`);
          m.el.querySelector('[data-x="no"]').onclick = () => { m.close(); res(false); };
          m.el.querySelector('[data-x="ok"]').onclick = () => { reason = m.el.querySelector('[data-x="reason"]').value.trim(); if (!reason) { m.el.querySelector('[data-x="reason"]').focus(); return; } m.close(); res(true); };
        });
        if (!go) return;
        r = await ws.finalize(ui.project.id, subId, { force: true, reason });
      }
      if (r.ok) { toast(`${sub.org} 확정했습니다.`, 'ok'); await reload(); }
    });
  }

  const statusOpts = () => ({ skipDuplicates: ui.skipDup, title: (ui.statusTitle || '').trim() || undefined });

  async function preDownloadCheck(projects) {
    const notes = [];
    for (const p of projects) for (const s of summarizeProject(p)) {
      if (s.status !== 'finalized') notes.push(`${p.title} · ${s.org}: 확정되지 않음 (최신 r${s.rev} 사용)`);
      if (s.openMissing) notes.push(`${p.title} · ${s.org}: 응답하지 않은 누락 ${s.openMissing}건`);
      if (s.counts.error) notes.push(`${p.title} · ${s.org}: 오류 ${s.counts.error}건 남음`);
    }
    if (!notes.length) return true;
    return confirmBox('확인이 필요한 항목이 있습니다', `<ul>${notes.slice(0, 12).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>${notes.length > 12 ? `<small>외 ${notes.length - 12}건</small>` : ''}<p>이대로 내려받을까요?</p>`, '그래도 다운로드');
  }

  async function doZip() {
    const proj = ui.project;
    const ids = [...$('[data-w="project"]').querySelectorAll('[data-w="half"]:checked')].map((x) => x.value);
    const coIds = [...$('[data-w="project"]').querySelectorAll('[data-w="allco"]:checked')].map((x) => x.value);
    const halfName = ($('[data-w="halfname"]')?.value || '').trim();
    await busy('ZIP 만드는 중', async () => {
      const groups = [];
      const loadMany = async (list) => (await Promise.all(list.map((id) => store.getProject(id)))).filter(Boolean);
      const mainGroup = [...(await loadMany(ids)), await store.getProject(proj.id)].sort((a, b) => String(a.period).localeCompare(String(b.period)));
      groups.push(mainGroup);
      for (const id of coIds) { const p = await store.getProject(id); if (p) groups.push([p]); }
      if (!(await preDownloadCheck(groups.flat()))) return;
      const label = ids.length ? (halfName || mainGroup.map((p) => p.period).join('+')) : proj.period;
      const { zip, notes } = await buildBundle(ws, groups, { periodLabel: label, includeEstimates: ui.includeEstimates, status: statusOpts() });
      download(zip, `${label}_최종자료.zip`, 'application/zip');
      await recordDownload(`ZIP ${label} (${groups.map((g) => COMPANY_LABEL[g[0].company]).join(', ')})`);
      toast(notes.length ? `내려받았습니다. 안내 ${notes.length}건은 ZIP 의 취합_안내.txt 를 확인하세요.` : '내려받았습니다.', notes.length ? '' : 'ok');
    });
  }
  async function recordDownload(text) { const { updateProject } = await import('../src/store/index.js'); await updateProject(store, ui.project.id, (p) => { p.events.push({ ts: ws.now(), by: ws.user || '(이름 없음)', type: 'download', text }); return p; }); await reload(); }

  // ── 이벤트
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, id = b.dataset.id;
    try {
      if (act === 'open') await openProject($('[data-w="company"]').value, $('[data-w="period"]').value);
      else if (act === 'open-recent') { const p = ui.recent.find((x) => x.id === id); if (p) { $('[data-w="company"]').value = p.company; $('[data-w="period"]').value = p.period; await openProject(p.company, p.period); } }
      else if (act === 'drop-pending') { ui.pending.splice(Number(b.dataset.i), 1); render(); }
      else if (act === 'submit') await doSubmit();
      else if (act === 'toggle-sum') { ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); }
      else if (act === 'revise') { const inp = $('[data-w="revfiles"]'); inp.value = ''; inp.dataset.sub = id; inp.click(); }
      else if (act === 'history') await showHistory(ui.project.submissions.find((s) => s.id === id));
      else if (act === 'alerts') { const sub = ui.project.submissions.find((s) => s.id === id); const sum = summarizeProject(ui.project).find((x) => x.submissionId === id); await askMissing(sub, sum.missing, '누락 알림(다시 응답)'); }
      else if (act === 'finalize') await doFinalize(id);
      else if (act === 'reopen') await busy('확정 해제 중', async () => { ui.project = await ws.reopen(ui.project.id, id); await reload(); });
      else if (act === 'order') await busy('순서 변경 중', async () => { const r = await ws.moveStatusOrder(ui.project.id, id, Number(b.dataset.dir)); if (r) ui.project = r; await reload(); });
      else if (act === 'toggle-preview') { ui.preview = !ui.preview; render(); }
      else if (act === 'dl-summary') { const wb = summaryWorkbook([ui.project]); download(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), `검토요약_${ui.project.title}.xlsx`); }
      else if (act === 'dl-status') await busy('실시현황 만드는 중', async () => { const { merged } = ws.buildStatus(ui.project, statusOpts()); download(XLSX.write(statusToWorkbook(merged), { type: 'array', bookType: 'xlsx' }), `실시현황_${COMPANY_LABEL[ui.project.company]}_${ui.project.period}.xlsx`); await recordDownload('취합 실시현황 xlsx'); });
      else if (act === 'dl-usage') await busy('사용실태 만드는 중', async () => { const a = ws.assemble(ui.project, statusOpts()); download(XLSX.write(usageToWorkbook(a.usage, `${COMPANY_LABEL[ui.project.company]} ${ui.project.period} 사용실태 취합`), { type: 'array', bookType: 'xlsx' }), `사용실태_${COMPANY_LABEL[ui.project.company]}_${ui.project.period}.xlsx`); await recordDownload('취합 사용실태 xlsx'); });
      else if (act === 'dl-zip') await doZip();
    } catch (e) { console.error(e); toast('오류: ' + (e?.message || e), 'err'); }
  });
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.matches('[data-w="files"]')) { await prepareFiles([...t.files]); t.value = ''; }
    else if (t.matches('[data-w="revfiles"]')) { if (t.files.length) await doRevise(t.dataset.sub, [...t.files]); }
    else if (t.matches('[data-w="skipdup"]')) { ui.skipDup = t.checked; render(); }
    else if (t.matches('[data-w="inc-est"]')) ui.includeEstimates = t.checked;
    else if (t.matches('[data-w="half"]')) { t.checked ? ui.selectedHalf.add(t.value) : ui.selectedHalf.delete(t.value); }
    else if (t.matches('[data-w="mode"]')) ui.mode = t.value;
    else if (t.matches('[data-w="user"]')) { ws.setUser(t.value.trim()); try { localStorage.setItem('qr-user', t.value.trim()); } catch { /* 무시 */ } }
  });
  root.addEventListener('input', (ev) => { const t = ev.target; if (t.matches('[data-w="stitle"]')) ui.statusTitle = t.value; else if (t.matches('[data-w="halfname"]')) ui.halfName = t.value; else if (t.matches('[data-w="org"]')) ui.orgInput = t.value; });
  // 끌어놓기
  root.addEventListener('dragover', (ev) => { if (ev.target.closest('[data-w="drop"]')) ev.preventDefault(); });
  root.addEventListener('drop', async (ev) => { const d = ev.target.closest('[data-w="drop"]'); if (!d) return; ev.preventDefault(); await prepareFiles([...ev.dataTransfer.files]); });

  // 골격 (한 번만)
  root.innerHTML = `
    <div class="qr-card"><h2>분기 작업 <small data-w="storeinfo"></small></h2>
      <div class="qr-row" style="margin-top:0"><label>건설사 <select data-w="company">${Object.entries(COMPANY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>기간 <input type="text" data-w="period" placeholder="예: 2026-2분기" style="width:140px"></label>
        <label>검토 방식 <select data-w="mode"><option value="quarter">분기 — 견적↔계획서↔결과서 전체 흐름</option><option value="adhoc">수시 — 견적↔측정계획서만</option></select></label>
        <label>내 이름 <input type="text" data-w="user" placeholder="이력에 남습니다" style="width:120px" value="${esc(ws.user)}"></label>
        <button class="primary" data-act="open">작업 열기·만들기</button></div>
      <div data-w="recent"></div></div>
    <div data-w="project" hidden></div>`;
  root.querySelector('[data-w="storeinfo"]').textContent = store.kind === 'server' ? '· 공유 서버에 저장 (여러 명이 같은 이력 사용)' : store.volatile ? '· 저장소를 쓸 수 없어 이 탭을 닫으면 사라집니다' : '· 이 브라우저에만 저장됩니다 (여러 명이 쓰려면 공유 서버 필요)';
  refreshRecent().then(render);

  return { ws, ui, reload, openProject, get store() { return store; } };
}
