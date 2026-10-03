import { ConflictError } from './errors.js';

/** 공유 서버 저장소 (server/server.mjs). 여러 사람이 같은 이력을 본다. */
export class HttpStore {
  constructor(baseUrl = '', { token = '' } = {}) { this.base = baseUrl.replace(/\/$/, ''); this.token = token; this.kind = 'server'; }
  _h(extra = {}) { return { ...(this.token ? { 'x-token': this.token } : {}), ...extra }; }
  async _fetch(path, init = {}) {
    const res = await fetch(this.base + path, { ...init, headers: this._h(init.headers) });
    if (res.status === 409) throw new ConflictError();
    if (res.status === 401) throw new Error('서버 접근 토큰이 올바르지 않습니다.');
    return res;
  }
  async listProjects() { const r = await this._fetch('/api/projects'); if (!r.ok) throw new Error('목록을 불러오지 못했습니다 (' + r.status + ')'); return r.json(); }
  async getProject(id) { const r = await this._fetch('/api/projects/' + encodeURIComponent(id) + '?soft=1'); if (r.status === 404) return null; if (!r.ok) throw new Error('불러오기 실패 (' + r.status + ')'); return r.json(); }
  async saveProject(project, expectedRev) {
    const r = await this._fetch('/api/projects/' + encodeURIComponent(project.id), { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': String(expectedRev ?? 0) }, body: JSON.stringify(project) });
    if (!r.ok) throw new Error('저장 실패 (' + r.status + ')');
    return r.json();
  }
  async putBlob(hash, data) {
    if (await this.hasBlob(hash)) return;
    const r = await this._fetch('/api/blobs/' + hash, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: data });
    if (!r.ok) throw new Error('파일 저장 실패 (' + r.status + ')');
  }
  async hasBlob(hash) { const r = await this._fetch('/api/blobs/' + hash + '/exists'); if (!r.ok) return false; return !!(await r.json()).exists; }
  async getBlob(hash) { const r = await this._fetch('/api/blobs/' + hash); if (r.status === 404) return null; if (!r.ok) throw new Error('파일 읽기 실패 (' + r.status + ')'); return r.arrayBuffer(); }
}
