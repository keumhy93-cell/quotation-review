import { ConflictError } from './errors.js';

// 파일 이름에 쓸 수 없는 문자(* 등)까지 안전하게
const enc = (id) => encodeURIComponent(id).replace(/[*'()!~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * 폴더 저장소 (File System Access API: Edge·Chrome). 공유 폴더(네트워크 드라이브, OneDrive/SharePoint 동기화 폴더 등)를
 * 고르면 PC 가 달라도 같은 폴더를 가리키는 한 같은 이력·단가표를 본다. 서버가 필요 없다.
 *   <폴더>/projects/<id>.json   <폴더>/blobs/<sha256>
 * 같은 프로젝트를 두 PC 가 동시에 저장하면 먼저 쓴 쪽이 이기고(rev 확인) 나중 쪽은 최신본을 다시 읽어 재시도한다.
 */
export class FsStore {
  constructor(root) { this.root = root; this.kind = 'folder'; this.label = root.name; this._locks = new Map(); }
  static supported() { return typeof globalThis.showDirectoryPicker === 'function'; }
  _dir(name) { return this.root.getDirectoryHandle(name, { create: true }); }
  async _read(dir, file) {
    try { return await (await dir.getFileHandle(file)).getFile(); } catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
  }
  async _json(dir, file) { const f = await this._read(dir, file); return f ? JSON.parse(await f.text()) : null; }
  async _write(dir, file, data) { const w = await (await dir.getFileHandle(file, { create: true })).createWritable(); await w.write(data); await w.close(); } // close 때 한 번에 교체(쓰다 끊겨도 원본 유지)
  _lock(id, fn) { const prev = this._locks.get(id) || Promise.resolve(); const next = prev.then(fn, fn); this._locks.set(id, next.catch(() => {})); return next; }

  async listProjects() {
    const dir = await this._dir('projects'), out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try { const p = JSON.parse(await (await h.getFile()).text()); out.push({ id: p.id, company: p.company, period: p.period, title: p.title, updatedAt: p.updatedAt, rev: p.rev, submissions: p.submissions.length }); } catch { /* 깨진 파일은 건너뜀 */ }
    }
    return out;
  }
  async getProject(id) { return this._json(await this._dir('projects'), enc(id) + '.json'); }
  /** 다른 PC 와 같은 프로젝트를 동시에 쓰지 않도록 잠금 파일(locks/<id>.lock)을 쓴다: 내 표식을 쓰고 다시 읽어 내 것일 때만 진행. 20초 넘은 잠금은 죽은 것으로 본다 */
  async _xlock(id, fn) {
    const dir = await this._dir('locks'), file = enc(id) + '.lock', mine = Math.random().toString(36).slice(2) + Date.now();
    for (let i = 0; ; i++) {
      const cur = await this._json(dir, file).catch(() => null);
      if (!cur || Date.now() - cur.at > 20000 || cur.by === mine) {
        await this._write(dir, file, JSON.stringify({ by: mine, at: Date.now() }));
        const back = await this._json(dir, file).catch(() => null);
        if (back?.by === mine) break;
      }
      if (i >= 40) throw new Error('다른 PC 가 같은 작업을 저장 중입니다. 잠시 후 다시 시도하세요.');
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    }
    try { return await fn(); } finally { try { await dir.removeEntry(file); } catch { /* 이미 정리됨 */ } }
  }
  saveProject(project, expectedRev) {
    return this._lock(project.id, () => this._xlock(project.id, async () => {
      const dir = await this._dir('projects'), file = enc(project.id) + '.json';
      const cur = await this._json(dir, file);
      if ((cur?.rev ?? 0) !== (expectedRev ?? 0)) throw new ConflictError();
      const next = { ...JSON.parse(JSON.stringify(project)), rev: (expectedRev ?? 0) + 1 };
      await this._write(dir, file, JSON.stringify(next));
      return next;
    }));
  }
  async putBlob(hash, data) {
    const dir = await this._dir('blobs');
    if (await this._read(dir, hash)) return;
    await this._write(dir, hash, new Uint8Array(data));
  }
  async hasBlob(hash) { return !!(await this._read(await this._dir('blobs'), hash)); }
  async getBlob(hash) { const f = await this._read(await this._dir('blobs'), hash); return f ? f.arrayBuffer() : null; }
}

// ── 고른 폴더를 브라우저에 기억 (다음에 열 때 한 번 허용만 누르면 되도록)
const kv = (mode, fn) => new Promise((ok, no) => {
  const req = indexedDB.open('quotation-review-prefs', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onerror = () => no(req.error);
  req.onsuccess = () => { const tx = req.result.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => ok(r.result); tx.onerror = () => no(tx.error); };
});
export const saveFolderHandle = (h) => kv('readwrite', (s) => s.put(h, 'folder'));
export const loadFolderHandle = () => kv('readonly', (s) => s.get('folder')).catch(() => null);
export async function folderPermission(h, ask = false) {
  const o = { mode: 'readwrite' };
  if ((await h.queryPermission?.(o)) === 'granted') return true;
  return ask ? (await h.requestPermission?.(o)) === 'granted' : false;
}
