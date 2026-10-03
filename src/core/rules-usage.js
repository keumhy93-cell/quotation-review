/**
 * 결과서 3번 검토: 측정계획의 유해인자 ↔ 사용실태(화학물질 사용 상태) 비고에 적힌 유해물질.
 * 사용실태에는 있는데 측정계획에 없는(누락) 경우, 아래 둘 중 하나로 사유가 설명되어 있어야 한다.
 *   (a) 분포실태에 관련 사유가 기재됨
 *   (b) 사용실태에 '임시·단시간 허용소비량 이하' 가 표시되어 있고 사용 주기도 구체적으로 적혀 있음
 */
import { finding as F, norm, canonHazard } from './util.js';

export const FREQ_RE = /(\d+\s*(회|시간|분|일|주|월|번))|((일|주|월|연)\s*\d+)|(매일|매주|매월|월\s*\d)/;
const REASON_RE = /(사유|제외|미측정|측정\s*(대상|하지)|소량|극소량|해당\s*없|사용\s*(안|하지)|허용소비량|임시|단시간)/;
const TEMP_RE = /(임시|단시간)[^]{0,40}허용\s*소비량|허용\s*소비량[^]{0,20}이하|임시\s*[·ㆍ,]?\s*단시간/;

/** 사용실태 행 텍스트에서 언급된 유해인자(정규화 키 → 표시명) */
export function mentionedHazards(text, aliases, knownNames) {
  const flat = norm(text), out = new Map();
  for (const k of Object.keys(aliases)) if (flat.includes(norm(k))) out.set(canonHazard(k, aliases), aliases[k]);
  for (const n of knownNames) if (n && flat.includes(norm(n))) out.set(canonHazard(n, aliases), n);
  return out;
}

export function reviewUsage(res, cfg, distFor = new Map()) {
  const out = [];
  const aliases = cfg.hazardAliases || {};
  const rows = res.usageRows || [];
  const known = [...new Set([...(res.summary || []).map((s) => s.hazard), ...(res.plan || []).map((p) => p.hazard)])];
  const byDept = new Map();
  for (const r of rows) byDept.set(r.dept, [...(byDept.get(r.dept) || []), r]);

  for (const [dept, rs] of byDept) {
    const planned = new Map((res.plan || []).filter((p) => p.dept === dept).map((p) => [canonHazard(p.hazard, aliases), p]));
    const blob = rs.map((r) => r.text).join(' ');
    const mentioned = new Map();
    for (const r of rs) for (const [k, v] of mentionedHazards(r.text, aliases, known)) mentioned.set(k, { name: v, row: r });
    const dist = distFor.get(dept);
    const distText = dist ? `${dist.hazards.join(' ')} ${dist.text}` : '';

    for (const [k, m] of mentioned) {
      if (planned.has(k)) continue;
      // 누락: 사유 확인
      const nm = norm(m.name);
      const tempMarked = TEMP_RE.test(m.row.text) || TEMP_RE.test(blob);
      const freq = FREQ_RE.test(m.row.text.replace(/임시|단시간/g, ''));
      const reasonInDist = !!dist && (norm(dist.text).includes(nm) || REASON_RE.test(dist.text));
      if (tempMarked && freq) out.push(F('info', '사용실태↔측정계획', `[${dept}] ${m.name}: 측정계획에는 없으나 사용실태에 임시·단시간 허용소비량 이하와 사용 주기가 기재되어 있습니다.`));
      else if (reasonInDist) out.push(F('info', '사용실태↔측정계획', `[${dept}] ${m.name}: 측정계획에는 없으나 분포실태에 사유가 기재되어 있습니다 (${dist.text.slice(0, 40)}…).`));
      else if (tempMarked) out.push(F('error', '임시·단시간', `[${dept}] ${m.name}: 사용실태에 임시·단시간 허용소비량이 표시되어 있으나 사용 주기(예: 월 2회, 1회 30분)가 적혀 있지 않습니다.`));
      else out.push(F('error', '측정 누락', `[${dept}] ${m.name}: 사용실태에는 있으나 측정계획에 없고, 분포실태 사유나 임시·단시간 허용소비량(주기 포함) 표시도 없습니다.`));
    }
    // 임시·단시간 표시가 있는데 분포실태에 내용이 없거나 주기가 없는 경우
    if (TEMP_RE.test(blob)) {
      if (!FREQ_RE.test(blob.replace(/임시|단시간/g, ''))) out.push(F('error', '임시·단시간', `[${dept}] 임시·단시간 허용소비량 표시가 있으나 비고에 사용빈도가 구체적이지 않습니다.`));
      if (dist && !/임시|단시간/.test(dist.text)) out.push(F('warn', '임시·단시간', `[${dept}] 임시·단시간 허용소비량 체크가 있으나 분포실태에 해당 내용이 기재되어 있지 않습니다 (분포실태에도 기재 권장).`));
    }
    // 반대 방향: 측정은 했는데 사용실태에 전혀 나오지 않는 화학인자 (참고)
    if (mentioned.size) for (const [k, p] of planned) if (!p.physical && !mentioned.has(k) && !/분진|흄/.test(p.hazard)) out.push(F('info', '사용실태↔측정계획', `[${dept}] ${p.hazard}: 측정하였으나 사용실태 비고에는 나오지 않습니다.`));
  }
  return out;
}
