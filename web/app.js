import { runReview, DEFAULT_CONFIG } from '../src/core/index.js';
import { loadWorkbook } from '../src/core/read.js';
import { pdfToText } from './pdf-text.js';

const $ = (s) => document.querySelector(s);
const state = { company: 'hyundai', est: null, sub: null, res: [], last: null };

// ── 설정(localStorage 는 막혀 있을 수 있으므로 try/catch)
const KEY = 'quotation-review-config-v1';
const clone = (o) => JSON.parse(JSON.stringify(o));
const loadCfg = () => { try { const t = localStorage.getItem(KEY); if (t) return JSON.parse(t); } catch { /* 무시 */ } return clone(DEFAULT_CONFIG); };
let cfg = loadCfg();
const showCfg = () => { $('#cfg').value = JSON.stringify(cfg, null, 2); };
$('#cfg-save').onclick = () => {
  try { cfg = JSON.parse($('#cfg').value); try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 무시 */ } $('#cfg-msg').textContent = '저장했습니다.'; }
  catch (e) { $('#cfg-msg').textContent = 'JSON 오류: ' + e.message; }
};
$('#cfg-reset').onclick = () => { cfg = clone(DEFAULT_CONFIG); try { localStorage.removeItem(KEY); } catch { /* 무시 */ } showCfg(); $('#cfg-msg').textContent = '기본값으로 되돌렸습니다.'; };

// ── 회사 탭
const applyCompany = () => {
  document.querySelectorAll('#companies button').forEach((b) => b.classList.toggle('on', b.dataset.co === state.company));
  const isCfg = state.company === 'config';
  $('#review').hidden = isCfg; $('#config').hidden = !isCfg;
  if (isCfg) showCfg();
  document.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== state.company; });
  $('#hint-est').textContent = state.company === 'hyundai' ? '표준품셈 견적서 (.xlsm) — 정기/수시·자동/수동 자동 판별' : '수수료 산출근거 엑셀 (.xlsx) — 현장별 블록 전체';
};
document.querySelectorAll('#companies button').forEach((b) => { b.onclick = () => { state.company = b.dataset.co; applyCompany(); }; });

// ── 파일 선택
const names = (fs) => [...fs].map((f) => f.name).join(', ');
const refresh = () => { $('#run').disabled = !state.est && !state.res.length; };
$('#f-est').onchange = (e) => { state.est = e.target.files[0] || null; $('#n-est').textContent = state.est?.name || ''; refresh(); };
$('#f-sub').onchange = (e) => { state.sub = e.target.files[0] || null; $('#n-sub').textContent = state.sub?.name || ''; };
$('#f-res').onchange = (e) => { state.res = [...e.target.files]; $('#n-res').textContent = names(state.res); refresh(); };
for (const [id, set] of [['#drop-est', 'f-est'], ['#drop-sub', 'f-sub'], ['#drop-res', 'f-res']]) {
  const el = $(id);
  el.ondragover = (ev) => { ev.preventDefault(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = (ev) => { ev.preventDefault(); el.classList.remove('over'); const inp = $('#' + set); inp.files = ev.dataTransfer.files; inp.dispatchEvent(new Event('change')); };
}

// ── 실행
const buf = (f) => f.arrayBuffer();
const isPdf = (f) => /\.pdf$/i.test(f.name);
$('#run').onclick = async () => {
  const btn = $('#run'); btn.disabled = true;
  try {
    $('#status').textContent = '파일 읽는 중…';
    await new Promise((r) => setTimeout(r));
    const estimateWb = state.est ? loadWorkbook(await buf(state.est), { select: state.company === 'hyundai' ? 'hyundai' : 'all' }) : null;
    const submissionWb = state.sub ? loadWorkbook(await buf(state.sub)) : null;
    const results = [];
    for (const f of state.res) {
      $('#status').textContent = `결과서 읽는 중… ${f.name}`;
      results.push(isPdf(f) ? { name: f.name, text: await pdfToText(await buf(f)) } : { name: f.name, wb: loadWorkbook(await buf(f)) });
    }
    $('#status').textContent = '검토 중…';
    await new Promise((r) => setTimeout(r));
    state.last = runReview({ company: state.company, type: $('#type').value || undefined, estimateWb, submissionWb, results, cfg });
    render();
    $('#status').textContent = '';
  } catch (e) {
    console.error(e);
    $('#status').textContent = '오류: ' + (e.message || e);
  } finally { btn.disabled = false; refresh(); }
};

// ── 결과 표시
const GROUPS = [
  ['estimate', '견적서 검토'], ['submission', '사업장 제출용 ↔ 견적서'], ['results', '결과서 검토'],
  ['resultSet', '결과서 간 비교'], ['compare', '결과서 ↔ 견적서'],
];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const SEV = { error: '오류', warn: '주의', info: '참고' };
const ORDER = { error: 0, warn: 1, info: 2 };

function render() {
  const showInfo = $('#show-info').checked;
  const r = state.last;
  const all = GROUPS.flatMap(([k]) => r[k] || []);
  const n = (sev) => all.filter((f) => f.severity === sev).length;
  $('#counts').innerHTML = `<span class="pill error">오류 ${n('error')}</span><span class="pill warn">주의 ${n('warn')}</span><span class="pill info">참고 ${n('info')}</span>` + (!n('error') && !n('warn') ? '<span class="pill ok">지적 사항 없음</span>' : '');
  const st = r.estimateStats;
  $('#stats').textContent = st ? Object.entries(st).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
  $('#groups').innerHTML = GROUPS.map(([k, title]) => {
    const list = (r[k] || []).filter((f) => showInfo || f.severity !== 'info').sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const raw = r[k] || [];
    if (!raw.length) return '';
    const e = raw.filter((f) => f.severity === 'error').length, w = raw.filter((f) => f.severity === 'warn').length;
    const rows = list.map((f) => `<tr><td class="sev"><span class="badge ${f.severity}">${SEV[f.severity]}</span></td><td class="cat">${esc(f.category)}</td><td>${esc(f.message)}${f.file ? `<div class="where">${esc(f.file)}</div>` : ''}</td><td class="where">${esc(f.where)}</td></tr>`).join('');
    return `<details class="grp" ${e || w ? 'open' : ''}><summary><h3>${title}</h3>${e ? `<span class="badge error">오류 ${e}</span>` : ''}${w ? `<span class="badge warn">주의 ${w}</span>` : ''}${!e && !w ? '<span class="badge info">이상 없음</span>' : ''}</summary><div class="body"><table><thead><tr><th></th><th>구분</th><th>내용</th><th>위치</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">표시할 항목이 없습니다.</td></tr>'}</tbody></table></div></details>`;
  }).join('');
  $('#out').hidden = false;
}
$('#show-info').onchange = () => state.last && render();

$('#export').onclick = () => {
  const r = state.last; if (!r) return;
  const rows = GROUPS.flatMap(([k, title]) => (r[k] || []).map((f) => ({ 구분: title, 심각도: SEV[f.severity], 분류: f.category, 내용: f.message, 위치: f.where, 파일: f.file || '' })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '검토결과');
  XLSX.writeFile(wb, `검토결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

applyCompany();
