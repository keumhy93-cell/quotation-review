// SheetJS 핸들. 브라우저는 전역 XLSX(위젯이 vendor 에서 로드 후 useXLSX 로 주입), Node 는 npm 패키지를 쓴다.
export let XLSX = globalThis.XLSX ?? null;
if (!XLSX && typeof process !== 'undefined' && process.versions?.node) {
  const m = await import('xlsx');
  XLSX = m.default ?? m;
}
export function useXLSX(lib) { XLSX = lib; }
