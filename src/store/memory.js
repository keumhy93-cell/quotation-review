import { ConflictError } from './errors.js';
const clone = (o) => JSON.parse(JSON.stringify(o));

/** 테스트·임시용 메모리 저장소. 모든 저장소가 같은 인터페이스를 따른다. */
export class MemoryStore {
  constructor() { this.projects = new Map(); this.blobs = new Map(); this.kind = 'memory'; }
  async listProjects() { return [...this.projects.values()].map((p) => ({ id: p.id, company: p.company, period: p.period, title: p.title, updatedAt: p.updatedAt, rev: p.rev, submissions: p.submissions.length })); }
  async getProject(id) { const p = this.projects.get(id); return p ? clone(p) : null; }
  /** 낙관적 잠금: expectedRev 가 저장된 rev 와 다르면 ConflictError. 성공하면 rev+1 을 부여한 사본을 돌려준다 */
  async saveProject(project, expectedRev) {
    const cur = this.projects.get(project.id);
    if ((cur?.rev ?? 0) !== (expectedRev ?? 0)) throw new ConflictError();
    const next = { ...clone(project), rev: (expectedRev ?? 0) + 1 };
    this.projects.set(project.id, next);
    return clone(next);
  }
  async putBlob(hash, data) { if (!this.blobs.has(hash)) this.blobs.set(hash, new Uint8Array(data).slice().buffer); }
  async hasBlob(hash) { return this.blobs.has(hash); }
  async getBlob(hash) { const b = this.blobs.get(hash); return b ? b.slice(0) : null; }
}
