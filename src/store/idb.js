import { ConflictError } from './errors.js';

/** 브라우저 IndexedDB 저장소 (이 브라우저에만 저장). 프로젝트 저장은 한 트랜잭션에서 rev 를 확인한다. */
export class IdbStore {
  constructor(name = 'quotation-review') { this.name = name; this.kind = 'idb'; this._db = null; }
  _open() {
    if (this._db) return this._db;
    this._db = new Promise((ok, no) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('projects', { keyPath: 'id' }); db.createObjectStore('blobs'); };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => no(req.error || new Error('IndexedDB 를 열 수 없습니다.'));
    });
    return this._db;
  }
  async _tx(stores, mode, fn) {
    const db = await this._open();
    return new Promise((ok, no) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => ok(result);
      tx.onerror = () => no(tx.error);
      tx.onabort = () => no(tx.error || new Error('저장 중단'));
      Promise.resolve(fn(tx)).then((r) => { result = r; }, (e) => { try { tx.abort(); } catch { /* 이미 종료 */ } no(e); });
    });
  }
  _req(r) { return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
  async listProjects() {
    const all = await this._tx(['projects'], 'readonly', (tx) => this._req(tx.objectStore('projects').getAll()));
    return all.map((p) => ({ id: p.id, company: p.company, period: p.period, title: p.title, updatedAt: p.updatedAt, rev: p.rev, submissions: p.submissions.length }));
  }
  async getProject(id) { return (await this._tx(['projects'], 'readonly', (tx) => this._req(tx.objectStore('projects').get(id)))) || null; }
  async saveProject(project, expectedRev) {
    return this._tx(['projects'], 'readwrite', async (tx) => {
      const st = tx.objectStore('projects');
      const cur = await this._req(st.get(project.id));
      if ((cur?.rev ?? 0) !== (expectedRev ?? 0)) throw new ConflictError();
      const next = { ...JSON.parse(JSON.stringify(project)), rev: (expectedRev ?? 0) + 1 };
      await this._req(st.put(next));
      return next;
    });
  }
  async putBlob(hash, data) {
    if (await this.hasBlob(hash)) return;
    const copy = new Uint8Array(data).slice().buffer;
    await this._tx(['blobs'], 'readwrite', (tx) => this._req(tx.objectStore('blobs').put(copy, hash)));
  }
  async hasBlob(hash) { return (await this._tx(['blobs'], 'readonly', (tx) => this._req(tx.objectStore('blobs').count(hash)))) > 0; }
  async getBlob(hash) { return (await this._tx(['blobs'], 'readonly', (tx) => this._req(tx.objectStore('blobs').get(hash)))) || null; }
}
