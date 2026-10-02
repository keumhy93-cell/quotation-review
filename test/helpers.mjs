import XLSX from 'xlsx';
export function wbFrom(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c && typeof c === 'object' && 'f' in c ? c : c))));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}
