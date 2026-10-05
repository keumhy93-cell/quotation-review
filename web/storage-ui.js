/**
 * 저장 위치 화면: 이력·단가표·업로드 파일을 어디에 둘지 고른다.
 *   공유 폴더 — 네트워크 드라이브/OneDrive 동기화 폴더 등을 고르면, 같은 폴더를 연결한 모든 PC가 같은 자료를 본다 (서버 불필요, Edge·Chrome)
 *   공유 서버 — 사내 서버(npm run serve:team) 주소를 입력
 *   이 브라우저 — 이 PC에서만
 */
import { FsStore, HttpStore, IdbStore, copyStore, saveFolderHandle, loadFolderHandle, folderPermission } from '../src/store/index.js';
import { getPref, setPref } from './workspace-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { folder: '공유 폴더', server: '공유 서버', idb: '이 PC의 브라우저' };

export function mountStorage(root, { currentStore, onChanged }) {
  const ui = { kind: getPref().kind || '', handle: null, msg: '', msgKind: '', busy: false };
  const pref = getPref();
  const $ = (s) => root.querySelector(s);
  const say = (m, k = '') => { ui.msg = m; ui.msgKind = k; const e = $('[data-s="msg"]'); if (e) { e.textContent = m; e.className = 'qr-msg ' + k; } };

  async function render() {
    const cur = await currentStore().catch(() => null);
    const supported = FsStore.supported();
    const kind = ui.kind || (cur ? (cur.kind === 'server' ? 'server' : cur.kind === 'folder' ? 'folder' : 'idb') : 'idb');
    const nowText = cur ? (cur.kind === 'folder' ? `공유 폴더 「${esc(cur.label)}」` : cur.kind === 'server' ? '공유 서버' : cur.kind === 'idb' ? '이 PC의 브라우저 (다른 PC에서는 보이지 않음)' : '임시 메모리 (닫으면 사라짐)') : '<span class="qr-msg err">연결되지 않음</span>';
    root.innerHTML = `
      <div class="qr-card"><h2>저장 위치 <small>이력·단가표·업로드한 파일을 어디에 보관할지</small></h2>
        <p>현재: <b>${nowText}</b></p>
        <p class="qr-mute">어느 PC에서든 같은 이력과 단가표를 보려면 <b>공유 폴더</b> 또는 <b>공유 서버</b>를 고르세요. 화면 파일(review.html)은 각 PC에 있어도 되고, 자료는 선택한 위치에 모입니다.</p></div>
      <div class="qr-card"><label class="qr-opt"><input type="radio" name="sk" value="folder" ${kind === 'folder' ? 'checked' : ''} ${supported ? '' : 'disabled'}> <b>공유 폴더</b> <span class="qr-badge info">서버 불필요 · 권장</span></label>
        <div class="qr-opt-body" ${kind === 'folder' ? '' : 'hidden'} data-s="p-folder">
          <p class="qr-mute">회사 공유 드라이브(예: <code>\\\\서버\\검토자료</code>), OneDrive·SharePoint 동기화 폴더처럼 <b>모든 PC에서 접근되는 폴더</b>를 고릅니다. 모든 PC에서 같은 폴더를 한 번씩 연결하면 됩니다. Edge·Chrome 에서 동작합니다.${supported ? '' : ' <span class="qr-msg err">이 브라우저는 폴더 선택을 지원하지 않습니다. Edge 또는 Chrome 을 쓰세요.</span>'}</p>
          <div class="qr-row"><button data-sa="pick-folder">폴더 선택</button><span data-s="folder-name" class="qr-mute">${ui.handle ? '선택: ' + esc(ui.handle.name) : ''}</span></div></div></div>
      <div class="qr-card"><label class="qr-opt"><input type="radio" name="sk" value="server" ${kind === 'server' ? 'checked' : ''}> <b>공유 서버</b> <span class="qr-badge info">사내 서버 필요</span></label>
        <div class="qr-opt-body" ${kind === 'server' ? '' : 'hidden'} data-s="p-server">
          <p class="qr-mute">서버 PC에서 <code>npm run serve:team</code> (외부 PC가 파일로 열 때는 <code>--cors</code> 추가, <code>--token</code> 권장)을 실행하고 그 주소를 적습니다.</p>
          <div class="qr-row"><label>서버 주소 <input type="text" data-s="url" style="min-width:280px" placeholder="http://서버주소:8080" value="${esc(pref.serverUrl || '')}"></label><label>접근 토큰 <input type="text" data-s="token" placeholder="(설정한 경우)" value="${esc(pref.token || '')}"></label><button data-sa="test">연결 테스트</button></div></div></div>
      <div class="qr-card"><label class="qr-opt"><input type="radio" name="sk" value="idb" ${kind === 'idb' ? 'checked' : ''}> <b>이 PC의 브라우저</b> <span class="qr-badge warn">이 PC 에서만 보임</span></label></div>
      <div class="qr-card"><label class="qr-chk"><input type="checkbox" data-s="copy" checked> 지금까지 저장된 작업·단가표를 새 위치로 복사 <small>(이미 같은 작업이 있으면 건너뜁니다)</small></label>
        <div class="qr-row"><button class="primary" data-sa="save">이 위치로 저장</button><span class="qr-msg ${ui.msgKind}" data-s="msg">${esc(ui.msg)}</span></div></div>`;
  }

  const kindNow = () => (root.querySelector('input[name="sk"]:checked') || {}).value || '';
  root.addEventListener('change', (e) => {
    if (e.target.name !== 'sk') return;
    ui.kind = e.target.value;
    ['folder', 'server'].forEach((k) => { const p = $(`[data-s="p-${k}"]`); if (p) p.hidden = ui.kind !== k; });
  });

  async function newStore() {
    const kind = kindNow();
    if (kind === 'folder') {
      const h = ui.handle || await loadFolderHandle(); if (!h) throw new Error('먼저 「폴더 선택」으로 폴더를 고르세요.');
      if (!(await folderPermission(h, true))) throw new Error('폴더 접근을 허용해야 저장할 수 있습니다.');
      return { kind, store: new FsStore(h), prefs: { kind } , handle: h };
    }
    if (kind === 'server') {
      const serverUrl = ($('[data-s="url"]').value || '').trim().replace(/\/$/, ''), token = ($('[data-s="token"]').value || '').trim();
      if (!serverUrl) throw new Error('서버 주소를 입력하세요.');
      const r = await fetch(serverUrl + '/api/health', { headers: token ? { 'x-token': token } : {} }).catch(() => null);
      if (!r) throw new Error('서버에 연결할 수 없습니다. 주소를 확인하고, 파일(review.html)로 열었다면 서버를 --cors 로 실행했는지 확인하세요.');
      if (r.status === 401) throw new Error('접근 토큰이 맞지 않습니다.');
      if (!r.ok) throw new Error('서버 응답 오류 (' + r.status + ')');
      return { kind, store: new HttpStore(serverUrl, { token }), prefs: { kind, serverUrl, token } };
    }
    if (kind === 'idb') return { kind, store: new IdbStore(), prefs: { kind } };
    throw new Error('저장 위치를 고르세요.');
  }

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-sa]'); if (!b || ui.busy) return;
    ui.busy = true;
    try {
      if (b.dataset.sa === 'pick-folder') {
        const h = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'qr-data' });
        ui.handle = h; $('[data-s="folder-name"]').textContent = '선택: ' + h.name; say('');
      } else if (b.dataset.sa === 'test') {
        const n = await newStore(); const list = await n.store.listProjects(); say(`연결되었습니다 (저장된 작업 ${list.filter((x) => !String(x.id).startsWith('__')).length}건).`, 'ok');
      } else if (b.dataset.sa === 'save') {
        say('확인 중…'); const n = await newStore();
        const from = await currentStore().catch(() => null);
        let note = '';
        if ($('[data-s="copy"]').checked && from && from.kind !== 'memory' && from !== n.store && !(from.kind === n.kind && from.kind !== 'idb' && n.kind !== 'idb' && (from.label ?? from.base) === (n.store.label ?? n.store.base))) {
          const r = await copyStore(from, n.store, (m) => say(m));
          note = ` 작업 ${r.projects}건·파일 ${r.blobs}개 복사${r.skipped ? `, 이미 있는 ${r.skipped}건은 건너뜀` : ''}.`;
        }
        if (n.handle) await saveFolderHandle(n.handle);
        setPref(n.prefs);
        say('저장했습니다.' + note, 'ok');
        await onChanged?.();
      }
    } catch (e) {
      if (e?.name !== 'AbortError') { console.error(e); say('오류: ' + (e?.message || e), 'err'); }
    } finally { ui.busy = false; }
  });

  render();
  return { reload: render };
}
