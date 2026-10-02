/**
 * 기본 설정. 웹 화면의 '설정' 탭에서 JSON 으로 수정 가능 (브라우저 localStorage 저장).
 */
export const DEFAULT_CONFIG = {
  companies: {
    hyundai: {
      label: '현대건설', pricing: '품셈',
      types: ['정기자동', '수시자동', '정기수동', '수시수동'],
      // 견적서 샘플(정기/수시)에서 읽은 값. factor=갑지 견적금액 계수(AA19 수식의 ×0.8 / ×0.55), wage=인건비 노임단가(R59~R62)
      rates: {
        정기: { factor: 0.8, wage: { 특급기술자: 347410, 고급기술자: 311177, 중급기술자: 260926, 초급기술자: 234568 } },
        수시: { factor: 0.55, wage: { 특급기술자: 260926, 고급기술자: 234568, 중급기술자: 260926, 초급기술자: 234568 } },
      },
    },
    // 계룡·한화의 기본관리비/분석수수료 단가는 견적서 안의 '단가' 시트에서 읽는다
    gyeryong: { label: '계룡건설', pricing: '단가제' },
    hanwha: { label: '한화건설', pricing: '단가제' },
  },
  // 엑셀 결과서의 표지 시트 인식용 키워드
  sheets: { resultCover: ['갑지', '표지', '결과'] },
  industry: '건설업',
  // 단가제 견적서의 약칭/분류명 → 결과서 유해인자명 (앞부분 일치). 실제 양식에 맞춰 추가
  hazardAliases: {
    용접흄: '용접흄및분진', 포틀랜드시멘트: '규산염(포틀랜드시멘트)', 규산염: '규산염(포틀랜드시멘트)', 산화철: '산화철분진과흄', 망간: '망간및그무기화합물',
    산화규소: '산화규소(결정체 석영)', 석영: '산화규소(결정체 석영)', 이산화티타늄: '이산화티타늄', 기타광물성분진: '기타광물성분진', 목재분진: '목재분진',
  },
  // 단가제 견적서 분석방법명 → 단가표 규격명
  methodAliases: { 'AAS(다성분)': 'AA분석(다성분)', 'AAS(단성분)': 'AA분석(단성분)', 'GC(다성분)': 'GC분석법(다성분)', 'GC(단성분)': 'GC분석법(단성분)', 'HPLC(다성분)': 'HPLC법(다성분)', 'HPLC(단성분)': 'HPLC법(단성분)', 'ICP': 'ICP법', 'GC법(단성분)': 'GC분석법(단성분)', 'GC법(다성분)': 'GC분석법(다성분)' },
  // 유해인자 → 허용되는 분석방법(앞부분 일치) 힌트
  hazardMethodHints: [
    { match: '소음', methods: ['소음노출량계', '주파수분석기', '지시소음기'] },
    { match: '산화규소|석영|유리규산', methods: ['FTIR'] },
    { match: '금속|망간|산화철|이산화티타늄|납|카드뮴|크롬', methods: ['AA분석', 'AAS', 'ICP'] },
    { match: '분진|용접흄|광물성|시멘트|목재|규산염', methods: ['중량분석법'] },
  ],
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/** 기본값 위에 사용자 설정을 깊게 덮어쓴다. 일부 항목만 있거나 오래된 저장본이어도 안전하다 (배열은 통째로 교체). */
export function mergeConfig(user, base = DEFAULT_CONFIG) {
  const out = JSON.parse(JSON.stringify(base));
  const walk = (dst, src) => {
    if (!isObj(src)) return dst;
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined) continue;
      if (isObj(v) && isObj(dst[k])) walk(dst[k], v);
      else dst[k] = JSON.parse(JSON.stringify(v));
    }
    return dst;
  };
  return walk(out, user);
}

/** 설정 값 점검: 문제가 있으면 사람이 읽을 수 있는 메시지 배열을 돌려준다. */
export function validateConfig(cfg) {
  const errs = [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const per of ['정기', '수시']) {
    const r = cfg?.companies?.hyundai?.rates?.[per];
    if (!r) { errs.push(`현대건설 ${per} 기준이 없습니다.`); continue; }
    if (!(num(r.factor) && r.factor > 0 && r.factor <= 1)) errs.push(`${per} 견적금액 계수는 0 초과 1 이하여야 합니다.`);
    for (const g of ['특급기술자', '고급기술자', '중급기술자', '초급기술자']) if (!num(r.wage?.[g])) errs.push(`${per} ${g} 노임단가가 올바른 숫자가 아닙니다.`);
  }
  if (!isObj(cfg?.hazardAliases)) errs.push('유해인자 별칭은 JSON 객체여야 합니다.');
  if (!isObj(cfg?.methodAliases)) errs.push('분석방법 별칭은 JSON 객체여야 합니다.');
  return errs;
}
