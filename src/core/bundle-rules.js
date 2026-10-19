/**
 * 다성분(한 시료로 묶는) 분석 규칙. 같은 분석방법(예: ICP)이라도 아무 인자나 한 시료로 묶을 수 있는 것은 아니다.
 *   single  : 단성분으로만 분석 — 어떤 인자와도 묶이면 안 된다 (예: 주석(유기화합물))
 *   onlyWith: 이 목록 안의 인자끼리만 묶일 수 있다 (예: 수산화나트륨은 수산화칼륨과만)
 * 기준 관리(설정 JSON)의 bundleRules 로 추가·수정한다.
 */
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
export const DEFAULT_BUNDLE_RULES = {
  single: ['용접흄및분진', '용접흄', '주석(유기화합물)', '산화아연(분진)'],
  onlyWith: [['수산화나트륨', '수산화칼륨']],
};

// 인자 이름은 고정값과 정확히 일치해야 한다 (공백·(STEL)/(TWA) 허용기준 표기만 무시)
const plain = (s) => norm(s).replace(/\((stel|twa|ceiling)\)/g, '');
const hit = (h, rule) => !!plain(rule) && plain(h) === plain(rule);

/** 인자의 묶음 종류: {kind:'single'} | {kind:'set', id, set} | {kind:'free'} */
export function bundleKind(h, rules = DEFAULT_BUNDLE_RULES) {
  if ((rules.single || []).some((r) => hit(h, r))) return { kind: 'single' };
  const i = (rules.onlyWith || []).findIndex((set) => set.some((r) => hit(h, r)));
  if (i >= 0) return { kind: 'set', id: i, set: rules.onlyWith[i] };
  return { kind: 'free' };
}

/** 한 시료로 묶인 인자 목록이 규칙을 어기면 사유 문장 배열을 돌려준다 (인자가 1개면 항상 통과) */
export function bundleViolations(hazards, rules = DEFAULT_BUNDLE_RULES) {
  const out = [];
  if ((hazards || []).length < 2) return out;
  for (const h of hazards) {
    const k = bundleKind(h, rules), others = hazards.filter((x) => x !== h);
    if (k.kind === 'single') out.push(`${h} 은(는) 단성분 분석이라 다른 인자와 한 시료로 묶을 수 없습니다 (함께 묶인 인자: ${others.join(', ')})`);
    else if (k.kind === 'set') {
      const bad = others.filter((x) => !k.set.some((r) => hit(x, r)));
      if (bad.length) out.push(`${h} 은(는) ${k.set.filter((r) => !hit(h, r)).join('·')} 와(과)만 한 시료로 묶을 수 있습니다 (함께 묶인 인자: ${bad.join(', ')})`);
    }
  }
  return out;
}

/** 서로 병합될 수 있는 묶음 키: 단성분은 병합 대상이 아니므로 null, 같은 키끼리만 한 시료가 될 수 있다 */
export function bundleKey(hazards, rules = DEFAULT_BUNDLE_RULES) {
  const ks = (hazards || []).map((h) => bundleKind(h, rules));
  if (ks.some((k) => k.kind === 'single')) return null;
  const sets = new Set(ks.filter((k) => k.kind === 'set').map((k) => k.id));
  if (sets.size === 1 && ks.every((k) => k.kind === 'set')) return `set${[...sets][0]}`;
  if (!sets.size) return 'free';
  return null; // 규칙 위반으로 섞인 경우 — 병합 후보로 보지 않는다 (위반은 bundleViolations 가 지적)
}
