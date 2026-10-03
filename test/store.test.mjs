import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { MemoryStore, ConflictError, updateProject, sha256, sha256Sync } from '../src/store/index.js';

test('sha256: 순수 JS 구현이 Node crypto 와 같다 (빈 값·경계 길이·큰 값)', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
    const b = randomBytes(n);
    const want = createHash('sha256').update(b).digest('hex');
    assert.equal(sha256Sync(b), want, `len ${n}`);
    assert.equal(await sha256(b), want);
  }
});

test('MemoryStore: rev 낙관적 잠금과 updateProject 재시도', async () => {
  const s = new MemoryStore();
  const p1 = await s.saveProject({ id: 'a', company: 'hyundai', period: 'x', submissions: [], events: [] }, 0);
  assert.equal(p1.rev, 1);
  await assert.rejects(() => s.saveProject({ ...p1 }, 0), ConflictError);
  // 동시 갱신 두 개: 둘 다 반영되어야 한다
  await Promise.all([1, 2, 3].map((n) => updateProject(s, 'a', (p) => ({ ...p, events: [...p.events, { n }] }))));
  const cur = await s.getProject('a');
  assert.equal(cur.events.length, 3);
  assert.equal(cur.rev, 4);
});

test('MemoryStore: blob 저장·조회', async () => {
  const s = new MemoryStore();
  const data = new Uint8Array([1, 2, 3]);
  await s.putBlob('h', data);
  assert.equal(await s.hasBlob('h'), true);
  assert.deepEqual([...new Uint8Array(await s.getBlob('h'))], [1, 2, 3]);
  assert.equal(await s.getBlob('none'), null);
});
