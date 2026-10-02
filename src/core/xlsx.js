// 브라우저에서는 전역 XLSX(web/vendor), Node에서는 npm 패키지를 사용
export const XLSX = globalThis.XLSX ?? (await import('xlsx')).default ?? (await import('xlsx'));
