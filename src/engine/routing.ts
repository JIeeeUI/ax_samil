import { THRESHOLDS } from './assumptions.js';
import { outflowInBreach, type CashResult } from './cash.js';
import type { Case } from './cases.js';

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

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/**
 * 승인 경로 (approval_authority_policy, covenant_terms_ms). 위에서부터 적용, 먼저 걸리는 쪽 우선.
 * 경계를 넘는 결정은 자동 확정하지 않고 상신한다.
 */
export function routeCase(c: Case, ctx: { breach: CashResult['breach']; planTotal: number }): Route {
  if (c.kind === 'contract' && c.amount > THRESHOLDS.contractAnnualKrw) {
    return c.cashOutflowDate === null
      ? { level: 'CEO_BOARD', reasons: [`전속계약 연 ${won(c.amount)} > 10억 원`, '현금 유출일 미확인'], needsInfo: ['cash_outflow_date'] }
      : { level: 'CEO_BOARD', reasons: [`전속계약 연 ${won(c.amount)} > 10억 원`], needsInfo: [] };
  }
  if (c.cashOutflowDate !== null && outflowInBreach(c.cashOutflowDate, ctx.breach)) {
    return {
      level: 'CEO_BOARD',
      reasons: [`현금 유출일 ${c.cashOutflowDate}이 covenant 하회 구간(${ctx.breach!.start}~${ctx.breach!.end}) 안`],
      needsInfo: [],
    };
  }
  if (c.kind === 'contract') {
    return c.cashOutflowDate === null
      ? { level: 'MASIL_CEO', reasons: ['전속계약 연 10억 원 이하', '현금 유출일 미확인: 하회 구간이면 CEO 상신으로 바뀜'], needsInfo: ['cash_outflow_date'] }
      : { level: 'MASIL_CEO', reasons: ['전속계약 연 10억 원 이하', '현금 유출일이 하회 구간 밖'], needsInfo: [] };
  }
  const reasons: string[] = [];
  if (c.amount > THRESHOLDS.perItemKrw) reasons.push(`건별 ${won(c.amount)} > 1천만 원`);
  if (ctx.planTotal > THRESHOLDS.planTotalKrw) reasons.push(`기안 총액 ${won(ctx.planTotal)} > 1억 원 [가정: 문서상 기안 금액으로 한도 적용]`);
  if (reasons.length > 0) return { level: 'MASIL_CEO_GROUP_REPORT', reasons, needsInfo: [] };
  return { level: 'MARKETING', reasons: ['건별 1천만 원 이하, 기안 총액 1억 원 이하, 하회 구간 밖'], needsInfo: [] };
}
