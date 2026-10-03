/**
 * 현대건설 견적서 PDF(총괄표 + 붙임1 인건비 세부산출내역서 + 붙임2 직접경비 세부산출내역서) 파서와
 * 인건비 건수·세부건수 ↔ 측정계획(엑셀) 대조.
 */
import { finding as F, norm, toNum } from './util.js';

/** '견적금액' → /견\s*적\s*금\s*액/ : PDF 추출기에 따라 글자 사이에 공백이 들어간다 */
const sp = (label) => String(label).replace(/\s+/g, '').split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
const num = (s) => { const n = Number(String(s ?? '').replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : null; };
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

export const isEstimatePdf = (text) => /인건비\s*세부\s*산출\s*내역서/.test(text) && /견\s*적/.test(text) && !/작업환경측정\s*결과/.test(text);

export function parseEstimatePdf(text, file = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\f/g, ''));
  const full = lines.join('\n');
  const r = { file, kind: 'estimate-pdf', gap: {}, labor: { methods: [] }, direct: {}, warnings: [] };

  const per = full.match(new RegExp(sp('작업환경측정') + '\\s*(정기|수시)\\s*' + sp('견적서')));
  r.period = per ? per[1] : null;
  r.issuer = (full.match(/공급자\s+(.+?)\s*$/m) || [])[1]?.trim() || null;
  // 갑지 금액
  const amt = (label) => { const m = full.match(new RegExp(sp(label) + '[^\\n]*?([\\d,]{3,})\\s*원')); return m ? num(m[1]) : null; };
  r.gap.labor = amt('직접인건비'); r.gap.direct = amt('직접경비'); r.gap.nego = amt('조정금액(NEGO)') ?? 0;
  const tot = full.match(new RegExp(sp('견적금액') + '[^\\n]*?₩\\s*([\\d,]+)')) || full.match(new RegExp(sp('견적금액') + '[^\\n]*?([\\d,]{5,})\\s*(?:\\[|$)', 'm'));
  r.gap.total = tot ? num(tot[1]) : null;

  // 현장명: '귀중' 앞쪽 왼쪽 열 조각들을 이어 붙인다 (줄바꿈된 현장명 복원)
  const k = lines.findIndex((l) => /귀중/.test(l));
  if (k >= 0) {
    const frag = [];
    for (let i = Math.max(0, k - 2); i <= k + 1; i++) {
      const left = lines[i].split(/\s{3,}/)[0].trim();
      if (left && /[가-힣]/.test(left) && !/견적담당자|김|담당자|귀중|아래와|견적사항/.test(left) && !/^[가-힣]\s*$/.test(left)) frag.push(left);
    }
    r.site = frag.join(' ').replace(/\s+/g, ' ').trim() || null;
  }

  // 인건비 세부산출내역서
  const pv = full.match(/측정\s*대상\s*인원\s*\(\s*인\s*\)\s*(\d+)/); r.labor.persons = pv ? Number(pv[1]) : null;
  const sv = full.match(/전체\s*시료\s*수\s*\(\s*건\s*\)\s*(\d+)/); r.labor.samples = sv ? Number(sv[1]) : null;
  const gm = full.match(/분석물질\s*\(GC\/MS\)\s*수\s*\(\s*건\s*\)\s*(\d+)/); r.labor.gcms = gm ? Number(gm[1]) : null;
  let cat = '';
  for (const l of lines) {
    const head = l.match(/^\s*(\d+\.\d+)\s+(\S+)\s*$/); // '4.1 소음' (수량 없는 분류 줄)
    if (head) { cat = head[2]; continue; }
    const m = l.match(/^\s*(\d+(?:\.\d+)+)\s+(.+?)\s+(\d+)\s+건(?:\s|$)/);
    if (m) {
      const id = m[1], label = m[2].trim();
      const isSub = id.split('.').length === 3; // 4.1.1 소음노출량계 → 분류는 직전 헤더
      const section = Number(id.split('.')[0]);
      r.labor.methods.push({ id, label, count: Number(m[3]), cat: isSub || /^4\./.test(id) ? cat : '', section });
    }
  }
  r.labor.methods = r.labor.methods.filter((m) => m.section === 4 || m.section === 5);
  // 노임단가
  r.labor.wage = {};
  for (const g of ['특급기술자', '고급기술자', '중급기술자', '초급기술자']) {
    const m = full.match(new RegExp(g + '\\s+([\\d,]{5,})\\s+([\\d.]+)\\s+([\\d,]+)'));
    if (m) r.labor.wage[g] = { price: num(m[1]), man: Number(m[2]), amount: num(m[3]) };
  }
  const lt = full.match(/인건비[\s\S]*?\n\s*계\s+([\d,]{5,})/); r.labor.total = lt ? num(lt[1]) : null;

  // 직접경비
  const d = (label) => { const m = full.match(new RegExp(label + '[^\\n]*\\n[^\\n]*?([\\d,]{3,})\\s*원[^\\n]*?([\\d,]{3,})\\s*원')); return m; };
  const tr = full.match(/출장여비\s*\(직접인건비의\s*10%\)[^\n]*\n[^\n]*?([\d,]+)\s+([\d,]+)\s*원/); r.direct.travel = tr ? num(tr[2]) : null;
  const dp = full.match(/감가상각비\s*\(직접인건비의\s*[\d.]+%\)[^\n]*\n[^\n]*?([\d,]+)\s+([\d,]+)\s*원/); r.direct.depreciation = dp ? num(dp[2]) : null;
  const mt = full.match(/측정\s*및\s*분석\s*재료비\s*\n\s*합\s*계\s+([\d,]+)\s*원/); r.direct.material = mt ? num(mt[1]) : null;
  const dt = full.match(/직접경비\s*합\s*계\s+([\d,]+)\s*원/); r.direct.total = dt ? num(dt[1]) : null;

  if (!r.labor.methods.length) r.warnings.push('견적서 PDF 에서 인건비 세부산출내역서(방법별 수량)를 읽지 못했습니다.');
  if (r.gap.total == null) r.warnings.push('견적서 PDF 에서 견적금액을 읽지 못했습니다.');
  return r;
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const matches = (item, planMethod) => {
  const a = norm(item.label), b = norm(planMethod);
  if (!b) return false;
  if (a === b) return true;
  return !!item.cat && b.includes(a) && b.includes(norm(item.cat));
};

/**
 * 견적서(PDF) 인건비 건수·세부건수 ↔ 측정계획(엑셀).
 * plan: { groups:[{method,samples,blank,unit:{people}}], material:[{method,count,hazards}] }  (parseHyundai / parseSubmission 결과)
 */
export function compareLaborToPlan(pdf, plan, label = '측정계획서') {
  const out = [];
  const L = pdf.labor;
  const phys = L.methods.filter((m) => m.section === 4), ana = L.methods.filter((m) => m.section === 5);
  const groups = plan.groups.filter((g) => !g.blank && g.samples > 0);
  const used = new Set();

  // 측정(물리) 방법별 세부건수
  for (const m of phys) {
    const hit = groups.filter((g) => matches(m, g.method));
    hit.forEach((g) => used.add(g));
    const n = sum(hit, (g) => g.samples);
    if (n !== m.count) out.push(F('error', '인건비↔계획서', `견적서 인건비 ${m.id} ${m.label}: ${m.count}건 / ${label} ${n}건`, pdf.file));
  }
  // 분석 방법별 세부건수 (재료비내역서의 분석방법별 건수, 공시료 포함)
  const mats = plan.material || [];
  for (const m of ana) {
    const n = sum(mats.filter((r) => norm(r.method) === norm(m.label)), (r) => r.count);
    if (mats.length && n !== m.count) out.push(F('error', '인건비↔재료비', `견적서 인건비 ${m.id} ${m.label}: ${m.count}건 / 재료비내역서 ${n}건 (공시료 포함)`, pdf.file));
  }
  // 계획서/재료비에는 있는데 견적서 인건비에 없는 방법
  const physLabels = new Set(phys.map((m) => m.id));
  for (const g of groups) if (!used.has(g) && g.method && !ana.some((m) => norm(m.label) === norm(g.method)) && !phys.some((m) => matches(m, g.method)) && !/^(개인|지역)$/.test(g.method)) {
    // 화학인자의 분석방법(AAS(다성분) 등)은 인건비 분석 항목으로 대조되므로, 어디에도 없는 방법만 지적
    if (!mats.some((r) => norm(r.method) === norm(g.method))) out.push(F('error', '인건비↔계획서', `${label}의 측정방법 '${g.method}' 이(가) 견적서 인건비 항목에 없습니다.`, pdf.file));
  }
  for (const r of mats) if (r.method && !ana.some((m) => norm(m.label) === norm(r.method))) out.push(F('error', '인건비↔재료비', `재료비내역서의 분석방법 '${r.method}' 이(가) 견적서 인건비 항목에 없습니다.`, pdf.file));

  // 전체 시료 수(건수)
  const all = sum(L.methods, (m) => m.count);
  if (L.samples != null && L.samples !== all) out.push(F('error', '인건비 건수', `전체 시료 수 ${L.samples}건 ≠ 방법별 세부건수 합 ${all}건`, pdf.file));
  const planAll = sum(groups.filter((g) => phys.some((m) => matches(m, g.method))), (g) => g.samples) + sum(mats, (r) => r.count);
  if (L.samples != null && mats.length && L.samples !== planAll) out.push(F('error', '인건비 건수', `전체 시료 수 ${L.samples}건 / ${label}(물리 측정) + 재료비내역서(분석, 공시료 포함) ${planAll}건`, pdf.file));

  // 측정 대상 인원
  const people = new Set(); let pSum = 0;
  for (const g of plan.groups) if (g.unit && !people.has(g.unit) && !g.blank) { people.add(g.unit); pSum += g.unit.people || 0; }
  if (L.persons != null && people.size && L.persons !== pSum) out.push(F('error', '인건비 인원', `측정 대상 인원 ${L.persons}명 / ${label} 측정인원수 합 ${pSum}명`, pdf.file));
  return out;
}

/** 견적서 PDF ↔ 같은 견적의 엑셀(xlsm): 인쇄본이 엑셀과 같은지 */
export function compareEstimatePdfToXlsx(pdf, est) {
  const out = [];
  const g = est.gap || {};
  const chk = (name, a, b) => { if (a != null && b != null && a !== b) out.push(F('error', '견적서 PDF↔엑셀', `${name}: PDF ${won(a)} / 엑셀 ${won(b)}`, pdf.file)); };
  chk('직접인건비', pdf.gap.labor, g.labor?.v); chk('직접경비', pdf.gap.direct, g.direct?.v); chk('견적금액', pdf.gap.total, g.total?.v);
  if (pdf.period && est.period && pdf.period !== est.period) out.push(F('error', '견적서 PDF↔엑셀', `정기/수시: PDF ${pdf.period} / 엑셀 ${est.period}`, pdf.file));
  chk('측정 대상 인원', pdf.labor.persons, est.labor?.persons?.v);
  const byLabel = (list) => new Map(list.map((x) => [norm(x.crit), x.v]));
  const eM = byLabel([...(est.labor?.measure || []), ...(est.labor?.analysis || [])]);
  for (const m of pdf.labor.methods) { const v = eM.get(norm(m.label)); if (v != null && m.count !== v && !m.cat) chk(`${m.id} ${m.label}`, m.count, v); }
  return out;
}

export { toNum };
