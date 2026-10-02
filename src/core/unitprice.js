/**
 * 계룡건설·한화건설(단가제) 수수료 산출근거 엑셀 파서 + 검증.
 * 한 파일에 현장별 블록이 여러 개 있다:
 *   실시현황(현장 목록) / '수수료 산출근거(…)' (No.n 블록: 기본측정비 + 공종×유해인자 표 + 합계) / 단가(기본관리비·분석수수료 단가표)
 */
import { readSheets, norm, toNum, finding as F, expectedSamples, canonHazard, diffMaps } from './util.js';

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const bracket = (label) => { const m = String(label).match(/(\d+)\s*-\s*(\d+)/); return m ? [Number(m[1]), Number(m[2])] : null; };
const stripCo = (s) => String(s ?? '').replace(/\(주\)|（주）|[㈜()（）]|주식회사/g, '').replace(/\s+/g, '');

/** '계룡건설산업㈜-인천검단 …' → { company, site } */
export function siteParts(name) {
  const t = String(name ?? '').replace(/^\[[^\]]*\]/, '').trim();
  // '상호-현장명' 형태일 때만 분리 (현장명 안의 '3-1공구' 같은 하이픈은 제외)
  let m = t.match(/^(.*?)\s*[-－–]\s*(.+)$/);
  if (m && !/건설|산업|㈜|\(주\)|한화|주식회사/.test(m[1])) m = null;
  const left = m ? m[1] : '';
  return { company: norm(stripCo(left)), site: norm(stripCo(m ? m[2] : t)), raw: t };
}
const sameSite = (a, b) => { const x = siteParts(a).site, y = siteParts(b).site; return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

export function parseUnitPrice(wb) {
  const sheets = readSheets(wb);
  const p = { blocks: [], status: [], table: { base: [], methods: new Map() }, warnings: [] };

  const tbl = sheets.find((s) => s.name === '단가');
  if (tbl) for (const row of tbl.rows) {
    const c = row?.[2], d = toNum(row?.[3]);
    if (c != null && d != null) {
      if (bracket(c)) p.table.base.push({ label: String(c).trim(), range: bracket(c), price: d });
      else p.table.methods.set(norm(c), d);
    }
  }
  else p.warnings.push("'단가' 시트를 찾지 못했습니다.");

  const st = sheets.find((s) => s.name.includes('실시현황'));
  if (st) {
    const h = st.rows.findIndex((r) => (r || []).some((v) => typeof v === 'string' && norm(v).includes('최종수수료')));
    if (h >= 0) {
      const col = (re) => (st.rows[h] || []).findIndex((v) => typeof v === 'string' && re.test(norm(v)));
      const cNo = col(/^no/), cName = col(/현장명/), cKind = col(/^구분$/), cFee = col(/최종수수료/), cHaz = col(/^인자$/);
      let cur = null;
      for (let r = h + 1; r < st.rows.length; r++) {
        const row = st.rows[r] || [];
        if (toNum(row[cNo]) != null && row[cName]) { cur = { no: toNum(row[cNo]), name: String(row[cName]), kind: String(row[cKind] ?? '').trim(), fee: toNum(row[cFee]), hazards: [], row: r + 1 }; p.status.push(cur); }
        if (cur && row[cHaz]) cur.hazards.push(String(row[cHaz]).trim());
      }
    }
  } else p.warnings.push("'실시현황' 시트를 찾지 못했습니다.");

  const fee = sheets.find((s) => s.name.includes('수수료 산출근거'));
  if (!fee) { p.warnings.push("'수수료 산출근거' 시트를 찾지 못했습니다."); return p; }
  let b = null, mode = null, gong = '';
  fee.rows.forEach((row, r) => {
    row = row || [];
    const a = typeof row[0] === 'string' ? row[0].trim() : row[0];
    const no = typeof a === 'string' && a.match(/^No\.\s*(\d+)/);
    if (no) { b = { no: Number(no[1]), items: [], sheet: fee.name, row: r + 1, baseTable: p.table.base }; p.blocks.push(b); mode = null; gong = ''; return; }
    if (!b) return;
    const A = norm(a);
    if (A === '현장명') { b.name = String(row[1] ?? '').trim(); b.periodText = String(row[4] ?? ''); b.period = /수시/.test(b.periodText) ? '수시' : /정기/.test(b.periodText) ? '정기' : null; b.date = toNum(row[8]); return; }
    if (A === '총근로자수') { b.base = { row: r + 1, workers: toNum(row[1]), label: String(row[3] ?? '').trim(), unit: toNum(row[4]), unitF: fee.formula(r, 4), days: toNum(row[6]), amount: toNum(row[7]) }; return; }
    if (A === '공종') { mode = 'items'; return; }
    if (A.startsWith('측정분석수수료합계')) { b.itemsTotal = { row: r + 1, v: toNum(row[7]) }; mode = null; return; }
    if (A.startsWith('작업환경측정수수료합계')) { b.feeTotal = { row: r + 1, v: toNum(row[4]) }; return; }
    if (A === '조정금액') { b.adjust = toNum(row[4]) ?? 0; return; }
    if (A.startsWith('최종수수료')) { b.final = { row: r + 1, v: toNum(row[4]), h: toNum(row[7]) }; return; }
    if (mode === 'items' && (row[1] || row[3])) {
      if (a) gong = String(a).replace(/\s+/g, ' ').trim();
      const hazardText = String(row[1] ?? '').trim();
      b.items.push({
        row: r + 1, gong, hazardText, category: String(row[2] ?? '').trim(), method: String(row[3] ?? '').trim(),
        workers: toNum(row[5]), samples: toNum(row[6]) ?? 0, price: toNum(row[7]), priceF: fee.formula(r, 7), amount: toNum(row[8]), amountF: fee.formula(r, 8),
      });
    }
  });
  return p;
}

/** '금속류\n(이산화티타늄,망간,산화철)' → ['이산화티타늄','망간','산화철'] / '용접흄' → ['용접흄'] */
export function expandHazards(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (m && /,/.test(m[2]) && /류$/.test(m[1].trim())) return m[2].split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  return [t];
}

export function blockGroups(block, cfg) {
  const al = cfg.hazardAliases || {};
  return block.items.map((it) => ({ hazards: expandHazards(it.hazardText), samples: it.samples, blank: false, dept: it.gong, method: it.method, canon: expandHazards(it.hazardText).map((h) => canonHazard(h, al)) }));
}

export function reviewUnitPrice(est, cfg) {
  const out = [];
  est.warnings.forEach((w) => out.push(F('warn', '파싱', w)));
  const mAlias = Object.fromEntries(Object.entries(cfg.methodAliases || {}).map(([k, v]) => [norm(k), norm(v)]));
  const priceOf = (m) => { const k = norm(m); return est.table.methods.get(k) ?? est.table.methods.get(mAlias[k]); };
  const hints = (cfg.hazardMethodHints || []).map((h) => ({ re: new RegExp(h.match), methods: h.methods }));
  if (!est.blocks.length) out.push(F('error', '파싱', "'수수료 산출근거' 에서 현장 블록(No. n)을 찾지 못했습니다."));

  for (const b of est.blocks) {
    const tag = `No.${b.no} ${String(b.name).slice(0, 18)}`;
    const w = (row) => `${tag} · ${b.sheet} ${row}행`;

    // 1) 기본측정비(기본관리인원): 근로자 수 → 규모 구간 → 단가
    if (b.base) {
      const want = est.table.base.find((x) => b.base.workers >= x.range[0] && b.base.workers <= x.range[1]);
      if (!want) out.push(F('error', '기본관리비', `총 근로자 ${b.base.workers}명에 해당하는 규모가 단가표에 없습니다.`, w(b.base.row)));
      else {
        if (norm(b.base.label) !== norm(want.label)) out.push(F('error', '기본관리비', `총 근로자 ${b.base.workers}명 → 규모 '${want.label}' 이어야 하는데 '${b.base.label}' 로 입력됨`, w(b.base.row)));
        const byLabel = est.table.base.find((x) => norm(x.label) === norm(b.base.label));
        if (byLabel && b.base.unit !== byLabel.price) out.push(F('error', '기본관리비', `기본관리비 단가 ${won(b.base.unit)} ≠ 단가표 ${won(byLabel.price)} (${byLabel.label})`, w(b.base.row)));
        if (b.base.unit === want.price && norm(b.base.label) !== norm(want.label)) out.push(F('warn', '기본관리비', '단가는 맞으나 규모 표기가 다릅니다.', w(b.base.row)));
      }
      if (b.base.unit != null && !b.base.unitF) out.push(F('warn', '연동', `기본관리비 단가 ${won(b.base.unit)} 가 수식(VLOOKUP)이 아닌 직접 입력 값입니다.`, w(b.base.row)));
      if (b.base.unit != null && b.base.days != null && b.base.amount !== b.base.unit * b.base.days) out.push(F('error', '기본관리비', `금액 ${won(b.base.amount)} ≠ 단가 ${won(b.base.unit)} × ${b.base.days}일`, w(b.base.row)));
    } else out.push(F('error', '기본관리비', '기본측정비(총 근로자수) 행을 찾지 못했습니다.', tag));

    // 2) 유해인자별 행
    let sumAmt = 0;
    const emptyCat = [];
    const gongWorkers = new Map();
    for (const it of b.items) {
      const need = it.workers != null ? expectedSamples(it.workers) : null;
      if (need != null && it.samples !== need) out.push(F('error', '인원↔건수', `[${it.gong}] ${it.hazardText.replace(/\s+/g, ' ')}: 동일노출 근로자 ${it.workers}명 → ${need}건, 입력 ${it.samples}건`, w(it.row)));
      const unit = priceOf(it.method);
      if (unit == null) out.push(F('warn', '단가', `분석방법 '${it.method}' 이(가) 단가표에 없습니다 (명칭 확인/별칭 등록).`, w(it.row)));
      else if (it.price !== unit) out.push(F('error', '단가', `[${it.gong}] ${it.method}: 단가 ${won(it.price)} ≠ 단가표 ${won(unit)}`, w(it.row)));
      if (it.price != null && !it.priceF) out.push(F('warn', '연동', `[${it.gong}] ${it.method}: 단가가 수식이 아닌 직접 입력 값`, w(it.row)));
      if (it.price != null && it.amount !== it.samples * it.price) out.push(F('error', '금액', `[${it.gong}] ${it.method}: ${it.samples}건 × ${won(it.price)} = ${won(it.samples * it.price)} ≠ 금액 ${won(it.amount)}`, w(it.row)));
      if (!it.category) emptyCat.push(it.row);
      const hint = hints.find((h) => h.re.test(it.hazardText));
      if (hint && !hint.methods.some((m) => norm(it.method).includes(norm(m)))) out.push(F('warn', '방법↔인자', `[${it.gong}] ${it.hazardText.replace(/\s+/g, ' ')} 에 '${it.method}' 가 적용됨 (통상: ${hint.methods.join('/')})`, w(it.row)));
      sumAmt += it.amount || 0;
      if (it.workers != null && !gongWorkers.has(it.gong)) gongWorkers.set(it.gong, it.workers);
    }
    if (emptyCat.length) out.push(F('warn', '분류', `${tag}: 분류(유해인자 구분) 열이 비어 있는 행 ${emptyCat.length}개 (VLOOKUP 값 없음 — 외부 링크 끊김 확인): ${emptyCat.slice(0, 6).join(', ')}행${emptyCat.length > 6 ? ' …' : ''}`, b.sheet));
    // 3) 근로자수 합
    const sumW = [...gongWorkers.values()].reduce((a, x) => a + x, 0);
    if (b.base?.workers != null && gongWorkers.size) {
      if (sumW > b.base.workers) out.push(F('error', '근로자수', `공종별 근로자 합 ${sumW}명이 총 근로자수 ${b.base.workers}명보다 많습니다 (기본관리비 규모 구간 오류 가능).`, w(b.base.row)));
      else if (sumW < b.base.workers) out.push(F('info', '근로자수', `공종별 측정 대상 근로자 합 ${sumW}명 < 총 근로자수 ${b.base.workers}명 (일부 공종 미측정 — 의도한 것인지 확인).`, w(b.base.row)));
    }
    // 4) 합계 체인
    if (b.itemsTotal?.v != null && b.itemsTotal.v !== sumAmt) out.push(F('error', '합계', `측정분석 수수료 합계 ${won(b.itemsTotal.v)} ≠ 행 금액 합 ${won(sumAmt)}`, w(b.itemsTotal.row)));
    if (b.feeTotal?.v != null && b.itemsTotal?.v != null && b.base?.amount != null && b.feeTotal.v !== b.itemsTotal.v + b.base.amount) out.push(F('error', '합계', `수수료 합계 ${won(b.feeTotal.v)} ≠ 측정분석 ${won(b.itemsTotal.v)} + 기본관리비 ${won(b.base.amount)}`, w(b.feeTotal.row)));
    if (b.final?.v != null && b.feeTotal?.v != null && b.final.v !== b.feeTotal.v - (b.adjust || 0)) out.push(F('error', '합계', `최종 수수료 ${won(b.final.v)} ≠ 수수료 합계 ${won(b.feeTotal.v)} − 조정 ${won(b.adjust || 0)}`, w(b.final.row)));

    // 5) 실시현황 대조
    const s = est.status.find((x) => x.no === b.no);
    if (!s) out.push(F('warn', '실시현황', `${tag}: 실시현황에 No.${b.no} 행이 없습니다.`));
    else {
      if (!sameSite(s.name, b.name)) out.push(F('error', '실시현황', `${tag}: 현장명 불일치 — 산출근거 '${b.name}' / 실시현황 '${s.name}'`));
      else if (siteParts(s.name).company && siteParts(b.name).company && siteParts(s.name).company !== siteParts(b.name).company) out.push(F('warn', '실시현황', `${tag}: 상호 표기가 다릅니다 — 산출근거 '${siteParts(b.name).raw}' / 실시현황 '${siteParts(s.name).raw}'`));
      if (b.period && s.kind && !s.kind.includes(b.period)) out.push(F('error', '실시현황', `${tag}: 구분 불일치 — 산출근거 '${b.period}' / 실시현황 '${s.kind}'`));
      if (b.final?.v != null && s.fee !== b.final.v) out.push(F('error', '실시현황', `${tag}: 최종수수료 ${won(b.final.v)} ≠ 실시현황 ${won(s.fee)}`));
    }
  }
  // 파일 내 상호 표기 일관성
  const cos = [...new Set(est.blocks.map((b) => siteParts(b.name).company).filter(Boolean))];
  if (cos.length > 1) out.push(F('warn', '상호 표기', `블록마다 상호가 다릅니다: ${est.blocks.map((b) => `No.${b.no} ${siteParts(b.name).raw.split(/[-－]/)[0]}`).join(' / ')}`));
  out.stats = { blocks: est.blocks.length };
  return out;
}

/** 결과서(PDF/엑셀 공통 형태)와 견적 블록 비교 */
export function compareBlockToResult(block, res, cfg) {
  const out = [];
  const al = cfg.hazardAliases || {};
  const tag = `No.${block.no}`;
  if (res.cover?.period && block.period && res.cover.period !== block.period) out.push(F('error', '결과서↔견적', `${tag}: 견적 ${block.period} / 결과서 ${res.cover.period}`));
  if (res.cover?.workers != null && block.base?.workers != null && res.cover.workers !== block.base.workers) out.push(F('error', '결과서↔견적', `${tag}: 총 근로자수 견적 ${block.base.workers}명 / 결과서 ${res.cover.workers}명 ${bracketChange(block, res.cover.workers)}`));
  if (res.cover?.site && !sameSite(res.cover.site, block.name)) out.push(F('error', '결과서↔견적', `${tag}: 현장명 불일치 — 견적 '${block.name}' / 결과서 '${res.cover.site}'`));
  else if (res.cover?.site && siteParts(res.cover.site).company && siteParts(block.name).company && siteParts(res.cover.site).company !== siteParts(block.name).company) out.push(F('warn', '결과서↔견적', `${tag}: 상호 표기 상이 — 견적 '${siteParts(block.name).raw}' / 결과서 '${res.cover.site}'`));

  // 공종(부서)별 인원·유해인자별 건수
  const resDepts = new Map();
  for (const p of res.plan || []) { const a = resDepts.get(p.dept) || { workers: p.workers, hz: new Map() }; a.hz.set(canonHazard(p.hazard, al), (a.hz.get(canonHazard(p.hazard, al)) || 0) + p.count); resDepts.set(p.dept, a); }
  const estDepts = new Map();
  for (const it of block.items) {
    const a = estDepts.get(it.gong) || { workers: it.workers, hz: new Map() };
    for (const h of expandHazards(it.hazardText)) a.hz.set(canonHazard(h, al), (a.hz.get(canonHazard(h, al)) || 0) + it.samples);
    estDepts.set(it.gong, a);
  }
  const dk = (s) => norm(String(s).replace(/\[[^\]]*\]/g, ''));
  for (const [gong, a] of estDepts) {
    const rd = [...resDepts].find(([d]) => dk(d) === dk(gong));
    if (!rd) { out.push(F('error', '결과서↔견적', `${tag} [${gong}]: 견적의 공종이 결과서 측정계획에 없습니다.`)); continue; }
    const [dept, b] = rd;
    if (a.workers != null && b.workers != null && a.workers !== b.workers) out.push(F('error', '결과서↔견적', `${tag} [${gong}]: 근로자수 견적 ${a.workers}명 / 결과서 ${b.workers}명`));
    for (const d of diffMaps(a.hz, b.hz)) out.push(F('error', '결과서↔견적', `${tag} [${gong}] ${[...(res.plan || [])].find((p) => canonHazard(p.hazard, al) === d.key)?.hazard || [...estDepts.get(gong).hz.keys()].find((k) => k === d.key) || d.key}: 견적 ${d.a}건 / 결과서 ${d.b}건`, d.a > d.b ? '견적 과다(결과서 누락)' : '견적 부족(결과서에만 있음)'));
  }
  for (const [dept] of resDepts) if (![...estDepts.keys()].some((g) => dk(g) === dk(dept))) out.push(F('error', '결과서↔견적', `${tag} [${dept}]: 결과서 공정이 견적에 없습니다.`));
  return out;
}

const bracketChange = (block, workers) => {
  const f = (n) => (block.baseTable || []).find((x) => n >= x.range[0] && n <= x.range[1]);
  const a = f(block.base.workers), b = f(workers);
  return a && b && a.label !== b.label ? `→ 기본관리비 구간 변경 (${a.label} ${won(a.price)} → ${b.label} ${won(b.price)})` : '(기본관리비 구간은 동일)';
};
/** 현장명으로 블록 찾기 */
export const findBlock = (est, siteName) => est.blocks.find((b) => sameSite(b.name, siteName));
