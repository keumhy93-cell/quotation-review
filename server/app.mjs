/**
 * 공유 저장 서버 (의존성 없음). 정적 파일(dist/) 호스팅 + 이력/파일 저장 API.
 *   GET  /api/health
 *   GET  /api/projects                 목록
 *   GET  /api/projects/:id             프로젝트(JSON)
 *   PUT  /api/projects/:id             저장 — If-Match: <rev> 가 현재 rev 와 다르면 409 (동시 수정 보호)
 *   HEAD|GET|PUT /api/blobs/:sha256    업로드 파일(내용 해시로 저장, 해시 불일치 시 거부)
 * 저장 위치: <dataDir>/projects/*.json, <dataDir>/blobs/<sha256>
 */
import http from 'node:http';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { join, normalize, extname, resolve, sep, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml' };
const MAX_JSON = 30 * 1024 * 1024, MAX_BLOB = 300 * 1024 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;

const json = (res, code, body) => { const s = JSON.stringify(body); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) }); res.end(s); };
const readBody = (req, limit) => new Promise((ok, no) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { no(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', no);
});
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createApp({ dataDir, staticDir = null, token = '', cors = false } = {}) {
  if (!dataDir) throw new Error('dataDir 가 필요합니다.');
  const projDir = join(dataDir, 'projects'), blobDir = join(dataDir, 'blobs');
  const ready = Promise.all([mkdir(projDir, { recursive: true }), mkdir(blobDir, { recursive: true })]);
  const locks = new Map(); // 프로젝트별 직렬화
  const withLock = (id, fn) => { const prev = locks.get(id) || Promise.resolve(); const next = prev.then(fn, fn); locks.set(id, next.catch(() => {})); return next; };
  const projFile = (id) => join(projDir, encodeURIComponent(id) + '.json');
  const readProject = async (id) => { try { return JSON.parse(await readFile(projFile(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const atomicWrite = async (path, data) => { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(tmp, data); await rename(tmp, path); };

  async function api(req, res, url) {
    if (token && !(req.headers['x-token'] && safeEq(req.headers['x-token'], token))) return json(res, 401, { error: 'unauthorized' });
    const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // ['projects', id]
    const [kind, id] = parts;
    if (kind === 'health') return json(res, 200, { ok: true, kind: 'server', auth: !!token });
    if (kind === 'projects' && !id && req.method === 'GET') {
      await mkdir(projDir, { recursive: true });
      const names = (await readdir(projDir)).filter((n) => n.endsWith('.json'));
      const list = [];
      for (const n of names) { try { const p = JSON.parse(await readFile(join(projDir, n), 'utf8')); list.push({ id: p.id, company: p.company, period: p.period, title: p.title, updatedAt: p.updatedAt, rev: p.rev, submissions: p.submissions.length }); } catch { /* 깨진 파일은 건너뜀 */ } }
      return json(res, 200, list);
    }
    if (kind === 'projects' && id) {
      if (req.method === 'GET') { const p = await readProject(id); if (p) return json(res, 200, p); return url.searchParams.get('soft') ? json(res, 200, null) : json(res, 404, { error: 'not found' }); } // soft=1: 없으면 404 대신 null (브라우저 콘솔 오류 방지)
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
        if (!body || body.id !== id || !Array.isArray(body.submissions)) return json(res, 400, { error: 'bad project' });
        const expected = Number(req.headers['if-match'] ?? 0);
        return withLock(id, async () => {
          const cur = await readProject(id);
          if ((cur?.rev ?? 0) !== expected) return json(res, 409, { error: 'conflict', rev: cur?.rev ?? 0 });
          const next = { ...body, rev: expected + 1 };
          await atomicWrite(projFile(id), JSON.stringify(next));
          return json(res, 200, next);
        });
      }
    }
    if (kind === 'blobs' && id && HASH_RE.test(id) && parts[2] === 'exists' && req.method === 'GET') { try { await stat(join(blobDir, id)); return json(res, 200, { exists: true }); } catch { return json(res, 200, { exists: false }); } }
    if (kind === 'blobs' && id && HASH_RE.test(id)) {
      const path = join(blobDir, id);
      if (req.method === 'HEAD' || req.method === 'GET') {
        let st; try { st = await stat(path); } catch { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size });
        return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(path), res);
      }
      if (req.method === 'PUT') {
        try { await stat(path); res.writeHead(200); return res.end(); } catch { /* 새 파일 */ }
        await mkdir(blobDir, { recursive: true });
        const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`; // 같은 파일을 동시에 올려도 임시 파일이 겹치지 않게
        const hash = createHash('sha256'); let n = 0;
        try {
          await pipeline(req, async function* (src) { for await (const c of src) { n += c.length; if (n > MAX_BLOB) throw Object.assign(new Error('too large'), { code: 413 }); hash.update(c); yield c; } }, createWriteStream(tmp));
        } catch (e) { await rm(tmp, { force: true }); return json(res, e.code === 413 ? 413 : 400, { error: 'upload failed' }); }
        if (hash.digest('hex') !== id) { await rm(tmp, { force: true }); return json(res, 400, { error: 'hash mismatch' }); }
        try { await rename(tmp, path); } catch (e) { await rm(tmp, { force: true }); try { await stat(path); } catch { throw e; } } // 동시에 올린 같은 파일이 먼저 저장됐다면 성공으로 본다
        res.writeHead(201); return res.end();
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  async function serveStatic(req, res, url) {
    if (!staticDir) { res.writeHead(404); return res.end(); }
    const root = resolve(staticDir);
    let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
    const full = resolve(root, '.' + normalize('/' + rel));
    if (full !== root && !full.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    try {
      const st = await stat(full); if (!st.isFile()) throw new Error('nf');
      res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
      return pipeline(createReadStream(full), res);
    } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
  }

  const server = http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://x');
      if (cors) { res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'content-type,if-match,x-token'); res.setHeader('access-control-allow-methods', 'GET,PUT,HEAD,OPTIONS'); if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await serveStatic(req, res, url);
    } catch (e) {
      if (!res.headersSent) json(res, e.code === 413 ? 413 : e instanceof SyntaxError ? 400 : 500, { error: e.code === 413 ? 'too large' : e instanceof SyntaxError ? 'bad json' : 'server error' });
      else res.end();
      if (!(e instanceof SyntaxError) && e.code !== 413) console.error(e);
    }
  });
  return server;
}
