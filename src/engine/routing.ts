import { THRESHOLDS } from './assumptions.js';
import { breachWindowFor, type BreachWindow } from './cash.js';
import type { Case } from './cases.js';
import { formatMan } from '../format.js';

export type RouteLevel = 'CEO_BOARD' | 'MASIL_CEO_GROUP_REPORT' | 'MASIL_CEO' | 'MARKETING';

export interface Route {
  level: RouteLevel;
  reasons: string[];
  needsInfo: string[];
}

export const ROUTE_LABEL: Record<RouteLevel, string> = {
  CEO_BOARD: 'CEO/이사회 상신',
  MASIL_CEO_GROUP_REPORT: 'Masil 대표 승인 + 그룹 보고',
  MASIL_CEO: 'Masil 대표 승인',
  MARKETING: '마케팅 전결',
};

const won = formatMan; // 표기만 공용 함수를 쓴다(금액 비교는 그대로)

/**
 * 승인 경로 (approval_authority_policy, covenant_terms_ms). 위에서부터 적용, 먼저 걸리는 쪽 우선.
 * 경계를 넘는 결정은 자동 확정하지 않고 상신한다.
 */
export function routeCase(c: Case, ctx: { breaches: BreachWindow[]; planTotal: number }): Route {
  const hit = c.cashOutflowDate === null ? null : breachWindowFor(c.cashOutflowDate, ctx.breaches);
  if (c.kind === 'contract' && c.amount > THRESHOLDS.contractAnnualKrw) {
    return c.cashOutflowDate === null
      ? { level: 'CEO_BOARD', reasons: [`전속계약 연 ${won(c.amount)} > 10억 원`, '현금 유출일 미확인'], needsInfo: ['cash_outflow_date'] }
      : { level: 'CEO_BOARD', reasons: [`전속계약 연 ${won(c.amount)} > 10억 원`], needsInfo: [] };
  }
  if (hit) {
    return {
      level: 'CEO_BOARD',
      reasons: [`현금 유출일 ${c.cashOutflowDate}이 covenant 하회 구간(${hit.start}~${hit.end}) 안`],
      needsInfo: [],
    };
  }
  if (c.kind === 'contract') {
    // 정책의 "연 10억 원"이 고정 피만인지 성과 피 포함 총 보수인지 문서에 정의가 없다 [가정: 고정 피 기준].
    // 고정 피가 10억 이하일 때만 성과 피 포함 시 10억을 넘을 수 있으므로 잠정 경로로 표시한다.
    const provisional = '성과 피 포함 시 10억 원 초과 여부 미확인: 잠정 경로';
    return c.cashOutflowDate === null
      ? { level: 'MASIL_CEO', reasons: ['전속계약 연 10억 원 이하(고정 피 기준)', '현금 유출일 미확인: 하회 구간이면 CEO 상신으로 바뀜', provisional], needsInfo: ['cash_outflow_date', 'performance_fee_terms'] }
      : { level: 'MASIL_CEO', reasons: ['전속계약 연 10억 원 이하(고정 피 기준)', '현금 유출일이 하회 구간 밖', provisional], needsInfo: ['performance_fee_terms'] };
  }
  const reasons: string[] = [];
  if (c.amount > THRESHOLDS.perItemKrw) reasons.push(`건별 ${won(c.amount)} > 1천만 원`);
  if (ctx.planTotal > THRESHOLDS.planTotalKrw) reasons.push(`기안 총액 ${won(ctx.planTotal)} > 1억 원 [가정: 문서상 기안 금액으로 한도 적용]`);
  if (reasons.length > 0) return { level: 'MASIL_CEO_GROUP_REPORT', reasons, needsInfo: [] };
  return { level: 'MARKETING', reasons: ['건별 1천만 원 이하, 기안 총액 1억 원 이하, 하회 구간 밖'], needsInfo: [] };
}
