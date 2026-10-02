/**
 * 견적서·결과서 검토 위젯.
 *   import { mountReview } from './widget.js';           // 소스 그대로
 *   import { mountReview } from './dist/quotation-review.js';  // 번들(npm run build)
 *   const qr = mountReview(document.getElementById('box'), { company: 'hyundai', onResult(r) {…} });
 *
 * opts
 *   company      처음 선택할 회사 'hyundai' | 'gyeryong' | 'hanwha' (기본 hyundai)
 *   companies    노출할 회사 목록 (기본 전부)
 *   config       호스트가 관리하는 기준 설정(일부만 줘도 됨). 주면 저장소(localStorage) 대신 이 값을 쓴다.
 *   storageKey   기준 설정을 브라우저에 저장할 키. null 이면 저장 안 함. (기본 'quotation-review-config-v1')
 *   onConfigChange(cfg)  기준 관리에서 저장할 때 호출 → 호스트 서버에 저장하려면 여기서 처리
 *   onResult(result)     검토가 끝날 때마다 호출
 *   assetBase    vendor/ 폴더(SheetJS·pdf.js)가 있는 URL (기본: 이 파일 위치)
 *   showConfig   기준 관리 탭 표시 여부 (기본 true)
 *   darkAuto     OS 다크모드 따라가기 (기본 true)
 */
import { runReview, DEFAULT_CONFIG, mergeConfig } from '../src/core/index.js';
import { validateConfig } from '../src/core/config.js';
import { loadWorkbook } from '../src/core/read.js';
import { useXLSX } from '../src/core/xlsx.js';
import { pdfToText } from './pdf-text.js';
import { CSS } from './widget-style.js';

const COMPANIES = { hyundai: ['현대건설', '품셈'], gyeryong: ['계룡건설', '단가제'], hanwha: ['한화건설', '단가제'] };
const GRADES = ['특급기술자', '고급기술자', '중급기술자', '초급기술자'];
const GROUPS = [['estimate', '견적서 검토'], ['submission', '사업장 제출용 ↔ 견적서'], ['results', '결과서 검토'], ['resultSet', '결과서 간 비교'], ['compare', '결과서 ↔ 견적서']];
const SEV = { error: '오류', warn: '주의', info: '참고' };
const ORDER = { error: 0, warn: 1, info: 2 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const defaultBase = () => new URL('./', import.meta.url).href;

// ── 외부 라이브러리 지연 로드 (SheetJS / pdf.js)
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) loaded.set(src, new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('라이브러리를 불러오지 못했습니다: ' + src)); document.head.appendChild(s); }));
  return loaded.get(src);
}
async function ensureXlsx(base) {
  if (!globalThis.XLSX) await loadScript(base + 'vendor/xlsx.full.min.js');
  useXLSX(globalThis.XLSX);
}
async function ensurePdf(base) {
  if (!globalThis.pdfjsLib) await loadScript(base + 'vendor/pdf.min.js');
  globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'vendor/pdf.worker.min.js';
}
function injectStyle() {
  if (document.getElementById('qr-style')) return;
  const st = document.createElement('style'); st.id = 'qr-style'; st.textContent = CSS; document.head.appendChild(st);
}

// ── 기준 설정 저장/복원 (localStorage 는 막혀 있을 수 있어 항상 try/catch)
const store = {
  get(k) { try { return k ? JSON.parse(localStorage.getItem(k) || 'null') : null; } catch { return null; } },
  set(k, v) { try { if (k) localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { if (k) localStorage.removeItem(k); } catch { /* 무시 */ } },
};

export function mountReview(el, opts = {}) {
  if (!el) throw new Error('mountReview: 컨테이너 요소가 필요합니다.');
  const o = { company: 'hyundai', companies: Object.keys(COMPANIES), storageKey: 'quotation-review-config-v1', assetBase: defaultBase(), showConfig: true, darkAuto: true, ...opts };
  o.companies = o.companies.filter((c) => COMPANIES[c]);
  if (!o.companies.length) o.companies = Object.keys(COMPANIES);
  if (!o.companies.includes(o.company)) o.company = o.companies[0];
  if (!o.assetBase.endsWith('/')) o.assetBase += '/';
  injectStyle();

  const st = { view: o.company, est: null, sub: null, res: [], last: null, busy: false, destroyed: false };
  let cfg = mergeConfig(o.config ?? store.get(o.storageKey) ?? {});

  el.classList.add('qr'); if (o.darkAuto) el.classList.add('qr-auto-dark');
  el.innerHTML = `
    <nav class="qr-tabs" data-r="tabs">
      ${o.companies.map((c) => `<button data-co="${c}">${COMPANIES[c][0]} <small>${COMPANIES[c][1]}</small></button>`).join('')}
      ${o.showConfig ? '<button data-co="config" class="qr-right">기준 관리</button>' : ''}
    </nav>
    <section data-r="review">
      <div class="qr-card">
        <h2>1. 파일 올리기</h2>
        <div class="qr-grid">
          <label class="qr-drop" data-r="drop-est"><b>견적서</b><span data-r="hint-est"></span><input type="file" data-r="f-est" accept=".xlsx,.xlsm,.xls"><em data-r="n-est"></em></label>
          <label class="qr-drop" data-r="drop-sub" data-only="hyundai"><b>사업장 제출용 엑셀 <small>(선택)</small></b><span>실시현황·계획서·재료비 — 견적서와 일치하는지 대조</span><input type="file" data-r="f-sub" accept=".xlsx,.xlsm,.xls"><em data-r="n-sub"></em></label>
          <label class="qr-drop" data-r="drop-res"><b>결과서 <small>(선택, 여러 개)</small></b><span>PDF 또는 엑셀</span><input type="file" data-r="f-res" accept=".pdf,.xlsx,.xlsm,.xls" multiple><em data-r="n-res"></em></label>
        </div>
        <div class="qr-row" data-only="hyundai">
          <label>견적 유형 <select data-r="type"><option value="">파일에서 자동 판별</option><option>정기자동</option><option>수시자동</option><option>정기수동</option><option>수시수동</option></select></label>
          <span class="qr-mute">선택한 유형과 파일 내용이 다르면 오류로 표시합니다.</span>
        </div>
        <div class="qr-row"><button class="primary" data-r="run" disabled>검토 실행</button><span class="qr-mute" data-r="status" role="status"></span></div>
      </div>
      <div data-r="out" hidden>
        <div class="qr-card">
          <div class="qr-row between"><h2>2. 검토 결과</h2><div class="qr-row" style="margin:0"><label class="qr-chk"><input type="checkbox" data-r="show-info"> 참고 보기</label><button data-r="export">엑셀로 저장</button></div></div>
          <div class="qr-counts" data-r="counts"></div><div class="qr-mute" data-r="stats"></div>
        </div>
        <div data-r="groups"></div>
      </div>
    </section>
    <section data-r="config" hidden>
      <div class="qr-card">
        <h2>기준 관리</h2>
        <p class="qr-mute">정기/수시 견적금액 계수와 인건비 노임단가를 관리합니다. 수시수동은 정기수동과 형태가 같고 이 값만 다릅니다.</p>
        <div class="qr-cfg-grid" data-r="cfg-form"></div>
        <div class="qr-cfg-box" style="margin-top:14px">
          <label>업종 <select data-r="cfg-industry"><option>건설업</option><option>기타</option></select></label>
          <p class="qr-mute" style="margin:4px 0">건설업이면 결과서 갑지에서 "2회 연속 미만/초과" 체크를 오류로 봅니다.</p>
        </div>
        <details style="margin-top:14px"><summary>유해인자·분석방법 별칭 (JSON)</summary>
          <p class="qr-mute">계룡·한화 견적서의 약칭을 결과서 유해인자명으로, 분석방법명을 단가표 규격명으로 연결합니다.</p>
          <b>유해인자 별칭</b><textarea data-r="cfg-haz" spellcheck="false"></textarea>
          <b>분석방법 별칭</b><textarea data-r="cfg-met" spellcheck="false"></textarea>
        </details>
        <div class="qr-row"><button class="primary" data-r="cfg-save">저장</button><button data-r="cfg-reset">기본값으로</button><button data-r="cfg-export">내보내기</button><label class="qr-drop" style="min-height:0;padding:6px 12px;border-style:solid"><span style="color:inherit">가져오기</span><input type="file" data-r="cfg-import" accept=".json,application/json"></label><span class="qr-msg" data-r="cfg-msg" role="status"></span></div>
      </div>
    </section>`;
  const $ = (r) => el.querySelector(`[data-r="${r}"]`);
  const $$ = (sel) => el.querySelectorAll(sel);
  const on = (node, ev, fn) => node.addEventListener(ev, fn);

  // ── 탭
  const applyView = () => {
    $$('[data-co]').forEach((b) => b.classList.toggle('on', b.dataset.co === st.view));
    const isCfg = st.view === 'config';
    $('review').hidden = isCfg; $('config').hidden = !isCfg;
    if (isCfg) fillConfig();
    $$('[data-only]').forEach((n) => { n.hidden = n.dataset.only !== st.view; });
    $('hint-est').textContent = st.view === 'hyundai' ? '표준품셈 견적서 (.xlsm) — 정기/수시·자동/수동을 파일에서 자동 판별' : '수수료 산출근거 엑셀 — 현장별 블록 전체';
    if (!isCfg) { st.last = null; $('out').hidden = true; }
  };
  $$('[data-co]').forEach((b) => on(b, 'click', () => { if (st.busy) return; st.view = b.dataset.co; applyView(); }));

  // ── 파일
  const refresh = () => { $('run').disabled = st.busy || (!st.est && !st.res.length); };
  const names = (fs) => fs.map((f) => f.name).join(', ');
  on($('f-est'), 'change', (e) => { st.est = e.target.files[0] || null; $('n-est').textContent = st.est?.name || ''; refresh(); });
  on($('f-sub'), 'change', (e) => { st.sub = e.target.files[0] || null; $('n-sub').textContent = st.sub?.name || ''; });
  on($('f-res'), 'change', (e) => { st.res = [...e.target.files]; $('n-res').textContent = names(st.res); refresh(); });
  for (const [drop, inp] of [['drop-est', 'f-est'], ['drop-sub', 'f-sub'], ['drop-res', 'f-res']]) {
    const d = $(drop);
    on(d, 'dragover', (ev) => { ev.preventDefault(); d.classList.add('over'); });
    on(d, 'dragleave', () => d.classList.remove('over'));
    on(d, 'drop', (ev) => { ev.preventDefault(); d.classList.remove('over'); const i = $(inp); try { i.files = ev.dataTransfer.files; } catch { return; } i.dispatchEvent(new Event('change')); });
  }

  // ── 실행
  const readBuf = (f) => f.arrayBuffer();
  const isPdf = (f) => /\.pdf$/i.test(f.name);
  const tick = () => new Promise((r) => setTimeout(r));
  async function run() {
    if (st.busy) return;
    st.busy = true; refresh();
    const say = (t) => { if (!st.destroyed) $('status').textContent = t; };
    try {
      say('라이브러리 준비 중…'); await ensureXlsx(o.assetBase);
      say('파일 읽는 중…'); await tick();
      const estimateWb = st.est ? loadWorkbook(await readBuf(st.est), { select: st.view === 'hyundai' ? 'hyundai' : 'all' }) : null;
      const submissionWb = st.sub && st.view === 'hyundai' ? loadWorkbook(await readBuf(st.sub)) : null;
      const results = [];
      for (const f of st.res) {
        say(`결과서 읽는 중… ${f.name}`);
        if (isPdf(f)) { await ensurePdf(o.assetBase); results.push({ name: f.name, text: await pdfToText(await readBuf(f)) }); }
        else results.push({ name: f.name, wb: loadWorkbook(await readBuf(f)) });
      }
      say('검토 중…'); await tick();
      st.last = runReview({ company: st.view, type: $('type').value || undefined, estimateWb, submissionWb, results, cfg });
      render(); say('');
      try { o.onResult?.(st.last); } catch (e) { console.error('onResult', e); }
    } catch (e) {
      console.error(e); say('오류: ' + (e?.message || e));
    } finally { st.busy = false; refresh(); }
  }
  on($('run'), 'click', run);

  // ── 결과 표시
  function render() {
    const r = st.last; if (!r) return;
    const showInfo = $('show-info').checked;
    const all = GROUPS.flatMap(([k]) => r[k] || []);
    const n = (s) => all.filter((f) => f.severity === s).length;
    $('counts').innerHTML = `<span class="qr-pill error">오류 ${n('error')}</span><span class="qr-pill warn">주의 ${n('warn')}</span><span class="qr-pill info">참고 ${n('info')}</span>${!n('error') && !n('warn') ? '<span class="qr-pill ok">지적 사항 없음</span>' : ''}`;
    $('stats').textContent = r.estimateStats ? Object.entries(r.estimateStats).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
    $('groups').innerHTML = GROUPS.map(([k, title]) => {
      const raw = r[k] || []; if (!raw.length) return '';
      const list = raw.filter((f) => showInfo || f.severity !== 'info').sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
      const e = raw.filter((f) => f.severity === 'error').length, w = raw.filter((f) => f.severity === 'warn').length;
      const rows = list.map((f) => `<tr><td class="sev"><span class="qr-badge ${f.severity}">${SEV[f.severity]}</span></td><td class="cat">${esc(f.category)}</td><td>${esc(f.message)}${f.file ? `<div class="where">${esc(f.file)}</div>` : ''}</td><td class="where">${esc(f.where)}</td></tr>`).join('');
      return `<details class="qr-grp" ${e || w ? 'open' : ''}><summary><h3>${title}</h3>${e ? `<span class="qr-badge error">오류 ${e}</span>` : ''}${w ? `<span class="qr-badge warn">주의 ${w}</span>` : ''}${!e && !w ? '<span class="qr-badge info">이상 없음</span>' : ''}</summary><div class="qr-body"><table><thead><tr><th></th><th>구분</th><th>내용</th><th>위치</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="qr-mute">표시할 항목이 없습니다.</td></tr>'}</tbody></table></div></details>`;
    }).join('');
    $('out').hidden = false;
  }
  on($('show-info'), 'change', render);
  on($('export'), 'click', async () => {
    if (!st.last) return;
    await ensureXlsx(o.assetBase);
    const rows = GROUPS.flatMap(([k, title]) => (st.last[k] || []).map((f) => ({ 구분: title, 심각도: SEV[f.severity], 분류: f.category, 내용: f.message, 위치: f.where, 파일: f.file || '' })));
    const X = globalThis.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.length ? rows : [{ 내용: '지적 사항 없음' }]), '검토결과');
    X.writeFile(wb, `검토결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  // ── 기준 관리
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  function fillConfig() {
    const rates = cfg.companies.hyundai.rates;
    $('cfg-form').innerHTML = ['정기', '수시'].map((p) => `
      <div class="qr-cfg-box" data-per="${p}"><h3>${p} <small>${p === '수시' ? '(수시자동·수시수동 공통)' : '(정기자동·정기수동 공통)'}</small></h3>
        <label>견적금액 계수 <input type="number" step="0.01" min="0" max="1" data-k="factor" value="${rates[p].factor}"></label>
        ${GRADES.map((g) => `<label>${g} 노임단가 <input type="number" step="1" min="0" data-g="${g}" value="${rates[p].wage[g]}"></label>`).join('')}
      </div>`).join('');
    $('cfg-industry').value = cfg.industry === '건설업' ? '건설업' : '기타';
    $('cfg-haz').value = JSON.stringify(cfg.hazardAliases, null, 2);
    $('cfg-met').value = JSON.stringify(cfg.methodAliases, null, 2);
    msg('');
  }
  const msg = (t, kind = '') => { const m = $('cfg-msg'); m.textContent = t; m.className = 'qr-msg ' + kind; };
  function readConfigForm() {
    const next = mergeConfig({}, cfg);
    for (const box of $$('[data-per]')) {
      const p = box.dataset.per, r = next.companies.hyundai.rates[p];
      r.factor = num(box.querySelector('[data-k="factor"]').value);
      for (const g of GRADES) r.wage[g] = num(box.querySelector(`[data-g="${g}"]`).value);
    }
    next.industry = $('cfg-industry').value === '건설업' ? '건설업' : '기타';
    next.hazardAliases = JSON.parse($('cfg-haz').value || '{}');
    next.methodAliases = JSON.parse($('cfg-met').value || '{}');
    return next;
  }
  function applyConfig(next) {
    const errs = validateConfig(next);
    if (errs.length) { msg(errs[0] + (errs.length > 1 ? ` (외 ${errs.length - 1}건)` : ''), 'err'); return false; }
    cfg = next;
    const saved = store.set(o.storageKey, cfg);
    try { o.onConfigChange?.(JSON.parse(JSON.stringify(cfg))); } catch (e) { console.error('onConfigChange', e); }
    msg(saved || !o.storageKey ? '저장했습니다.' : '적용했지만 브라우저 저장소에는 저장하지 못했습니다.', 'ok');
    return true;
  }
  on($('cfg-save'), 'click', () => {
    let next; try { next = readConfigForm(); } catch (e) { msg('별칭 JSON 형식 오류: ' + e.message, 'err'); return; }
    applyConfig(next);
  });
  on($('cfg-reset'), 'click', () => { store.del(o.storageKey); cfg = mergeConfig({}); try { o.onConfigChange?.(JSON.parse(JSON.stringify(cfg))); } catch (e) { console.error(e); } fillConfig(); msg('기본값으로 되돌렸습니다.', 'ok'); });
  on($('cfg-export'), 'click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
    a.download = 'quotation-review-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  on($('cfg-import'), 'change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const next = mergeConfig(JSON.parse(await f.text())); if (applyConfig(next)) fillConfig(); msg('가져와서 저장했습니다.', 'ok'); }
    catch (err) { msg('가져오기 실패: ' + err.message, 'err'); }
  });

  applyView();
  return {
    getConfig: () => JSON.parse(JSON.stringify(cfg)),
    setConfig(next) { cfg = mergeConfig(next ?? {}); if (st.view === 'config') fillConfig(); },
    getResult: () => st.last,
    destroy() { st.destroyed = true; el.innerHTML = ''; el.classList.remove('qr', 'qr-auto-dark'); },
  };
}
export { DEFAULT_CONFIG, runReview, mergeConfig };
