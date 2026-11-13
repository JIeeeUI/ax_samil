/**
 * 주의 항목 등급표와 통합 규칙(규칙으로 만든다. AI가 만들지 않는다).
 * 등급표는 사용자 확정 전 초안이므로 ATTENTION_TABLE 한 곳만 고치면 목록·정렬·태그가 모두 따라온다.
 */
import type { IsoDate } from '../engine/types.js';

export type Tier = 'high' | 'mid' | 'low';
export const TIER_LABEL: Record<Tier, string> = { high: '상', mid: '중', low: '하' };
const TIER_RANK: Record<Tier, number> = { high: 0, mid: 1, low: 2 };

export interface AttentionRule {
  tier: Tier;
  /** 목록 앞단에 보이는 짧은 태그 */
  tag: string;
  /** 사건 화면에 보이는 한 줄 설명 */
  text: string;
  /** 등급 근거 한 줄 */
  why: string;
}

/** 대표 코드별 등급표. 순서는 같은 등급 안에서의 표시 순서이기도 하다. */
export const ATTENTION_TABLE = {
  CONTRACT_OUTFLOW_UNKNOWN: { tier: 'high', tag: '지급일 미정', text: '돈이 나가는 날짜를 아직 모름', why: '하회 구간 해당 여부를 못 정해 승인 경로가 확정되지 않는다' },
  EXECUTION_BEFORE_DEADLINE: { tier: 'high', tag: '확정 전 집행', text: '확정되기 전에 집행이 시작됨', why: '집행이 확정기한보다 빨라 실효 결정 기한이 당겨진다' },
  LOSS: { tier: 'high', tag: '광고비 빼면 손해', text: '광고비를 빼면 손해', why: '실질 ROAS가 음수라 돈을 쓸수록 손해' },
  CASH_BREACH: { tier: 'high', tag: '현금 부족 구간', text: '돈이 나가는 날이 현금 부족 구간 안', why: '금액·종류 불문 CEO/이사회 승인 대상(승인 경로 규칙)' },
  AUTO_RENEW: { tier: 'high', tag: '자동 갱신 위험', text: '결정·통보 없이 기한이 지나면 계약이 자동 갱신됨', why: '기한을 놓치면 되돌릴 수 없는 결과' },
  ALLOCATION_INVERSION: { tier: 'mid', tag: '요청 대비 성과 낮음', text: '성과는 낮은데 예산 요청은 큼', why: '배분이 성과와 반대 방향(근거 해석이 필요)' },
  RETURN_RATE_ISSUE: { tier: 'mid', tag: '반품 높음', text: '반품이 기준보다 많이 높음', why: '기준 대비 3%p 초과(가정)' },
  PROVISIONAL_ROUTE: { tier: 'mid', tag: '성과 피 조건 미확인', text: '성과 피 포함 시 10억 원 초과 여부를 몰라 승인 경로가 잠정', why: '확인되면 결재자가 바뀔 수 있다' },
  RETURN_RATE_WARN: { tier: 'low', tag: '반품 다소 높음', text: '반품이 기준보다 조금 높음', why: '기준 대비 3%p 이내' },
  DISCOUNT_ABOVE_AVG: { tier: 'low', tag: '쿠폰 할인 큼', text: '쿠폰 할인이 평균보다 큼', why: '참고 지표' },
  SAMPLE_TOO_SMALL: { tier: 'low', tag: '표본 적음', text: '주문 수가 적어 판단 보류', why: '신뢰도 참고' },
} as const satisfies Record<string, AttentionRule>;
export type AttentionCode = keyof typeof ATTENTION_TABLE;

/**
 * 통합 규칙: 같은 사실을 말하는 경고는 대표 1개로 묶고 나머지는 대표의 상세 근거로 붙인다.
 * 키 = 합쳐지는 코드, 값 = 대표 코드.
 */
export const MERGE_INTO: Readonly<Record<string, AttentionCode>> = {
  ALLOCATION_INVERSION: 'LOSS', // 손해 + 요청 비중 역전: 한 가지 사실(돈을 쓸수록 손해인데 요청은 큼)
  RETURN_RATE_WARN: 'RETURN_RATE_ISSUE', // 반품 경고는 반품 이슈가 있으면 흡수
  CASH_OUTFLOW_DATE_UNCONFIRMED: 'CONTRACT_OUTFLOW_UNKNOWN', // 하회 구간 '미확인'
  LINK_WARNING: 'AUTO_RENEW', // 기안만 부결, 계약은 자동 갱신
};

export interface AttentionInput {
  /** 엔진 이슈 코드(캠페인·인플루언서·건 단위) */
  issues: readonly string[];
  /** 현금 유출일이 하회 구간 안/밖/미확인 */
  inBreach: '예' | '아니오' | '미확인';
  /** 성과 피 조건 미확인으로 경로가 잠정 */
  provisional: boolean;
  /** 같은 인플루언서 기안만 부결·계약은 미결정 경고 문구 */
  linkWarning?: string | null;
  /** 결정 전 기한 임박 계약의 자동 갱신 경고 문구 */
  autoRenewWarning?: string | null;
  effectiveDeadline: IsoDate;
}

export interface AttentionItem {
  code: AttentionCode;
  tier: Tier;
  tag: string;
  text: string;
  /** 대표에 묶인 같은 의미의 경고와 근거 문구 */
  details: string[];
  /** 정렬 기준(같은 등급이면 기한이 가까운 순) */
  dueDate: IsoDate;
}
export interface Attention {
  count: number;
  /** 목록 앞단의 "가장 중요한 태그 1개" */
  top: { code: AttentionCode; tier: Tier; tag: string } | null;
  items: AttentionItem[];
}

const ORDER = Object.keys(ATTENTION_TABLE) as AttentionCode[];

export function buildAttention(input: AttentionInput): Attention {
  const merged = new Map<AttentionCode, string[]>();
  const add = (code: AttentionCode, detail?: string) => {
    const cur = merged.get(code) ?? [];
    if (detail && !cur.includes(detail)) cur.push(detail);
    merged.set(code, cur);
  };
  for (const raw of input.issues) {
    const rep = (MERGE_INTO[raw] ?? raw) as AttentionCode;
    if (!Object.hasOwn(ATTENTION_TABLE, rep)) continue;
    // 흡수된 코드는 대표가 없으면 스스로 대표가 된다(예: 반품 경고만 있는 경우, 요청 비중 역전만 있는 경우).
    if (rep !== raw && !input.issues.includes(rep)) {
      if (Object.hasOwn(ATTENTION_TABLE, raw)) add(raw as AttentionCode);
      continue;
    }
    if (rep !== raw) add(rep, ATTENTION_TABLE[raw as AttentionCode].text);
    else add(rep);
  }
  if (input.inBreach === '예') add('CASH_BREACH');
  if (input.inBreach === '미확인') add('CONTRACT_OUTFLOW_UNKNOWN', '하회 구간 해당 여부 미확인');
  if (input.provisional) add('PROVISIONAL_ROUTE');
  if (input.linkWarning) add('AUTO_RENEW', input.linkWarning);
  if (input.autoRenewWarning) add('AUTO_RENEW', input.autoRenewWarning);

  const items: AttentionItem[] = [...merged.entries()]
    .map(([code, details]) => ({ code, tier: ATTENTION_TABLE[code].tier as Tier, tag: ATTENTION_TABLE[code].tag, text: ATTENTION_TABLE[code].text, details, dueDate: input.effectiveDeadline }))
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
  return { count: items.length, top: items[0] ? { code: items[0].code, tier: items[0].tier, tag: items[0].tag } : null, items };
}

/** 건 목록 정렬: 가장 높은 등급 먼저, 같은 등급이면 기한이 가까운 순, 주의가 없는 건은 뒤로. */
export function compareByAttention(a: { attention: Attention; effectiveDeadline: IsoDate }, b: { attention: Attention; effectiveDeadline: IsoDate }): number {
  const ra = a.attention.top ? TIER_RANK[a.attention.top.tier] : 3;
  const rb = b.attention.top ? TIER_RANK[b.attention.top.tier] : 3;
  return ra - rb || a.effectiveDeadline.localeCompare(b.effectiveDeadline);
}
