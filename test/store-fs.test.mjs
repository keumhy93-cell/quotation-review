import test from 'node:test';
import assert from 'node:assert/strict';
import { FsStore, MemoryStore, copyStore, ConflictError, sha256, updateProject } from '../src/store/index.js';

// File System Access API 의 폴더 핸들을 흉내 낸 메모리 구현 (같은 root 를 두 PC 가 공유하는 상황을 만든다)
class FakeFile { constructor(d) { this.d = d; } async text() { return new TextDecoder().decode(this.d); } async arrayBuffer() { return this.d.slice().buffer; } }
class FakeDir {
  constructor(name) { this.name = name; this.kind = 'directory'; this.m = new Map(); }
  async getDirectoryHandle(n, { create } = {}) { if (!this.m.has(n)) { if (!create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); this.m.set(n, new FakeDir(n)); } return this.m.get(n); }
  async getFileHandle(n, { create } = {}) {
    if (!this.m.has(n)) { if (!create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); this.m.set(n, { kind: 'file', data: new Uint8Array() }); }
    const e = this.m.get(n);
    return { kind: 'file', getFile: async () => new FakeFile(e.data), createWritable: async () => { let buf; return { write: async (x) => { buf = typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x); }, close: async () => { e.data = buf; } }; } };
  }
  async removeEntry(n) { this.m.delete(n); }
  async *entries() { for (const [k, v] of this.m) yield [k, v.kind === 'directory' ? v : { kind: 'file', getFile: async () => new FakeFile(v.data) }]; }
}
const proj = (id) => ({ id, company: 'hyundai', period: id, title: id, updatedAt: 't', submissions: [], events: [] });

test('폴더 저장소: 다른 PC(같은 폴더)에서도 같은 프로젝트·파일을 본다', async () => {
  const root = new FakeDir('공유');
  const pcA = new FsStore(root), pcB = new FsStore(root);
  const saved = await pcA.saveProject(proj('hyundai__2026-2분기'), 0);
  assert.equal(saved.rev, 1);
  assert.equal((await pcB.getProject('hyundai__2026-2분기')).rev, 1);
  assert.deepEqual((await pcB.listProjects()).map((p) => p.id), ['hyundai__2026-2분기']);
  const bytes = new TextEncoder().encode('견적서'); const h = await sha256(bytes);
  await pcA.putBlob(h, bytes);
  assert.equal(await pcB.hasBlob(h), true);
  assert.equal(new TextDecoder().decode(new Uint8Array(await pcB.getBlob(h))), '견적서');
  assert.equal(await pcB.getBlob('0'.repeat(64)), null);
});

test('폴더 저장소: 오래된 rev 로 저장하면 충돌, updateProject 는 재시도로 합친다', async () => {
  const root = new FakeDir('공유'), a = new FsStore(root), b = new FsStore(root);
  await a.saveProject(proj('p1'), 0);
  await assert.rejects(() => b.saveProject(proj('p1'), 0), ConflictError);
  await Promise.all([updateProject(a, 'p1', (p) => { p.events.push('A'); return p; }), updateProject(b, 'p1', (p) => { p.events.push('B'); return p; })]);
  assert.deepEqual((await a.getProject('p1')).events.sort(), ['A', 'B']);
});

test('저장 위치 바꾸기: 프로젝트·단가표·파일을 새 저장소로 복사, 이미 있는 것은 건너뜀', async () => {
  const from = new MemoryStore(), to = new FsStore(new FakeDir('새'));
  const bytes = new TextEncoder().encode('결과서'); const h = await sha256(bytes);
  await from.putBlob(h, bytes);
  const p = proj('hyundai__2026-1분기'); p.submissions = [{ id: 's', revisions: [{ files: [{ name: 'a.pdf', hash: h }] }] }];
  await from.saveProject(p, 0);
  await from.saveProject({ ...proj('__pricebook__'), years: { 2026: {} } }, 0);
  const r = await copyStore(from, to);
  assert.deepEqual(r, { projects: 2, skipped: 0, blobs: 1 });
  assert.equal((await to.getProject('__pricebook__')).years[2026] != null, true);
  assert.equal(await to.hasBlob(h), true);
  assert.deepEqual(await copyStore(from, to), { projects: 0, skipped: 2, blobs: 0 });
});
