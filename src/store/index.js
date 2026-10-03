import { ConflictError } from './errors.js';
export { MemoryStore } from './memory.js';
export { IdbStore } from './idb.js';
export { HttpStore } from './http.js';
export { ConflictError } from './errors.js';
export { sha256, sha256Sync, textBytes } from './hash.js';

/** 프로젝트를 읽어 mutate 한 뒤 저장. 다른 사람이 먼저 저장했으면(충돌) 최신본을 다시 읽어 같은 변경을 다시 적용한다. */
export async function updateProject(store, id, mutate, { retries = 6 } = {}) {
  for (let i = 0; ; i++) {
    const cur = await store.getProject(id);
    const next = await mutate(cur ? JSON.parse(JSON.stringify(cur)) : null);
    if (!next) return cur;
    try { return await store.saveProject(next, cur?.rev ?? 0); }
    catch (e) { if (!(e instanceof ConflictError) || i >= retries) throw e; }
  }
}
