// 브라우저 전용 SheetJS 핸들 (top-level await 없음). file:// 단일 파일 번들에서 사용.
export let XLSX = globalThis.XLSX ?? null;
export function useXLSX(lib) { XLSX = lib; }
