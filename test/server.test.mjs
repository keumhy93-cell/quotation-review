import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { HttpStore, ConflictError, updateProject, sha256 } from '../src/store/index.js';
import { Workspace } from '../src/core/workspace.js';
import { hyundaiWb, toBytes } from './fixture.mjs';

async function boot(opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'qr-'));
  const staticDir = join(dir, 'static'); await mkdir(staticDir); await writeFile(join(staticDir, 'index.html'), '<h1>hi</h1>');
  const server = createApp({ dataDir: join(dir, 'data'), staticDir, ...opts });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, dir, close: async () => { await new Promise((ok) => server.close(ok)); await rm(dir, { recursive: true, force: true }); } };
}

test('서버: 프로젝트 저장·충돌(409)·목록, blob 저장은 해시 검증', async () => {
  const s = await boot();
  try {
    const st = new HttpStore(s.base);
    assert.deepEqual(await st.listProjects(), []);
    assert.equal(await st.getProject('없음'), null);
    const p = await st.saveProject({ id: 'hyundai__2026-2분기', company: 'hyundai', period: '2026-2분기', submissions: [], events: [] }, 0);
    assert.equal(p.rev, 1);
    await assert.rejects(() => st.saveProject({ ...p }, 0), ConflictError);
    // 동시 갱신 3건이 모두 반영
    await Promise.all([1, 2, 3].map((n) => updateProject(st, p.id, (cur) => ({ ...cur, events: [...cur.events, { n }] }))));
    assert.equal((await st.getProject(p.id)).events.length, 3);
    assert.equal((await st.listProjects()).length, 1);

    const data = new TextEncoder().encode('한글 파일 내용');
    const h = await sha256(data);
    assert.equal(await st.hasBlob(h), false);
    await st.putBlob(h, data);
    assert.equal(await st.hasBlob(h), true);
    assert.equal(new TextDecoder().decode(await st.getBlob(h)), '한글 파일 내용');
    assert.equal(await st.getBlob('0'.repeat(64)), null);
    // 해시가 맞지 않는 업로드는 거부
    const bad = await fetch(`${s.base}/api/blobs/${'a'.repeat(64)}`, { method: 'PUT', body: data });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${s.base}/api/blobs/../../etc/passwd`)).status, 404);
  } finally { await s.close(); }
});

test('서버: 정적 파일 제공과 경로 이탈 차단', async () => {
  const s = await boot();
  try {
    assert.equal(await (await fetch(s.base + '/')).text(), '<h1>hi</h1>');
    const r = await fetch(s.base + '/..%2f..%2fetc%2fpasswd'); assert.ok([403, 404].includes(r.status));
    assert.equal((await fetch(s.base + '/nope.js')).status, 404);
  } finally { await s.close(); }
});

test('서버: 접근 토큰이 있으면 API 는 토큰 필요', async () => {
  const s = await boot({ token: 'secret' });
  try {
    assert.equal((await fetch(s.base + '/api/projects')).status, 401);
    assert.equal((await fetch(s.base + '/api/projects', { headers: { 'x-token': 'wrong' } })).status, 401);
    assert.equal((await fetch(s.base + '/api/projects', { headers: { 'x-token': 'secret' } })).status, 200);
    assert.deepEqual(await new HttpStore(s.base, { token: 'secret' }).listProjects(), []);
    await assert.rejects(() => new HttpStore(s.base, { token: 'x' }).listProjects());
    assert.equal((await fetch(s.base + '/')).status, 200); // 화면은 토큰 없이
  } finally { await s.close(); }
});

test('두 사용자가 같은 서버에서 업로드 → 서로의 이력이 보이고 수정본 충돌 없이 반영', async () => {
  const s = await boot();
  try {
    const mk = (user) => new Workspace({ store: new HttpStore(s.base), user, pdfToText: async () => '' });
    const a = mk('가'), b = mk('나');
    const site = '현대건설 (주)-가나 공동주택 신축공사';
    const wb = hyundaiWb({ site });
    const proj = await a.openProject('hyundai', '2026-2분기');
    await b.openProject('hyundai', '2026-2분기'); // 이미 있으면 그대로
    const f = async (ws, name) => ws.prepareFile({ name, data: toBytes(wb) });
    await Promise.all([
      a.submit(proj.id, { org: '인천센터', files: [await f(a, '인천.xlsx')], mode: 'adhoc' }),
      b.submit(proj.id, { org: '강원센터', files: [await f(b, '강원.xlsx')], mode: 'adhoc' }),
    ]);
    const p = await a.store.getProject(proj.id);
    assert.deepEqual(p.submissions.map((x) => x.org).sort(), ['강원센터', '인천센터']);
    assert.deepEqual(p.events.filter((e) => e.type === 'submit').map((e) => e.by).sort(), ['가', '나']);
    // 올린 파일을 다른 사용자가 내려받을 수 있다
    const meta = p.submissions[0].revisions[0].files[0];
    assert.ok((await b.store.getBlob(meta.hash)).byteLength > 1000);
  } finally { await s.close(); }
});
