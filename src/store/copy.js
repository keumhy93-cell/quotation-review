/** 한 저장소의 프로젝트·단가표·업로드 파일을 다른 저장소로 복사 (저장 위치를 바꿀 때). 같은 id 가 이미 있으면 덮어쓰지 않고 건너뛴다. */
export async function copyStore(from, to, onProgress = () => {}) {
  const list = await from.listProjects();
  let projects = 0, skipped = 0, blobs = 0;
  for (const meta of list) {
    if (await to.getProject(meta.id)) { skipped++; continue; }
    const p = await from.getProject(meta.id);
    if (!p) continue;
    const hashes = new Set();
    JSON.stringify(p, (k, v) => { if ((k === 'hash' || k === 'textHash') && /^[0-9a-f]{64}$/.test(v)) hashes.add(v); return v; });
    for (const h of hashes) {
      if (await to.hasBlob(h)) continue;
      const buf = await from.getBlob(h);
      if (buf) { await to.putBlob(h, buf); blobs++; }
      onProgress(`${meta.title || meta.id} 파일 복사 중…`);
    }
    await to.saveProject(p, 0); // 새 저장소에서는 rev 가 처음부터 다시 매겨진다
    projects++;
  }
  return { projects, skipped, blobs };
}
