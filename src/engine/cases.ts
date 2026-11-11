import { THRESHOLDS } from './assumptions.js';
import { daysBetween, minDate } from './calendar.js';
import type { DataRoom, IsoDate } from './types.js';

export interface Case {
  id: string;
  kind: 'plan' | 'contract';
  influencerId: string;
  campaignId: string | null;
  amount: number;
  /** 기안 금액은 표본 계열, 전속계약은 풀스케일 */
  amountScale: 'sample' | 'full';
  /** 확정기한 (지나면 자동 확정) */
  deadline: IsoDate;
  /** 집행 예정일 (settlement_date) */
  settlementDate: IsoDate | null;
  /** 현금 유출일 [가정: 집행 예정일과 같음]. 전속계약은 미확인(null) */
  cashOutflowDate: IsoDate | null;
  /** min(확정기한, 집행 예정일) */
  effectiveDeadline: IsoDate;
  executesBeforeDeadline: boolean;
  expectedGmv: number | null;
  /** 같은 인플루언서의 모든 건을 묶는다 */
  linkGroup: string;
}

export interface ContractTerms {
  annualFixedFeeKrw: number;
  noticeDeadline: IsoDate;
  expiry: IsoDate;
  cashOutflowDate: IsoDate | null;
}

/** 출처: 02_masil/marketing/inf001_exclusive_contract_notice.md (현금 유출일은 통보서에 없음) */
export const INF001_CONTRACT: ContractTerms = {
  annualFixedFeeKrw: 2_800_000_000,
  noticeDeadline: '2026-07-17',
  expiry: '2026-08-31',
  cashOutflowDate: null,
};

export function buildCases(room: DataRoom, contract: Partial<ContractTerms> = {}): Case[] {
  const inf = new Map(room.masters.campaigns.map((c) => [c.campaign_id, c.influencer_id]));
  const plans: Case[] = room.sample.budgetPlan.map((p) => {
    const influencerId = inf.get(p.campaign_id)!;
    return {
      id: p.plan_id,
      kind: 'plan',
      influencerId,
      campaignId: p.campaign_id,
      amount: p.requested_budget_krw,
      amountScale: 'sample',
      deadline: p.contract_deadline,
      settlementDate: p.settlement_date,
      cashOutflowDate: p.settlement_date,
      effectiveDeadline: minDate(p.contract_deadline, p.settlement_date),
      executesBeforeDeadline: p.settlement_date < p.contract_deadline,
      expectedGmv: p.expected_gmv_krw,
      linkGroup: influencerId,
    };
  });
  const t = { ...INF001_CONTRACT, ...contract };
  const c: Case = {
    id: 'CONTRACT-INF-001',
    kind: 'contract',
    influencerId: 'INF-001',
    campaignId: null,
    amount: t.annualFixedFeeKrw,
    amountScale: 'full',
    deadline: t.noticeDeadline,
    settlementDate: null,
    cashOutflowDate: t.cashOutflowDate,
    effectiveDeadline: t.noticeDeadline,
    executesBeforeDeadline: false,
    expectedGmv: null,
    linkGroup: 'INF-001',
  };
  return [...plans, c];
}

/** 기안 총액(승인 한도 판정용). 기안 행끼리 금액 규모가 다르면 합산하지 않는다. */
export function planTotal(cases: Case[]): number {
  const plans = cases.filter((c) => c.kind === 'plan');
  if (new Set(plans.map((c) => c.amountScale)).size > 1) throw new Error('scale mix');
  return plans.reduce((s, c) => s + c.amount, 0);
}

export type AlertStage = 'D-14' | 'D-7' | 'D-3' | 'overdue' | null;

/** 달력일 기준 남은 일수로 알림 단계를 정한다. */
export function alertStage(today: IsoDate, effectiveDeadline: IsoDate): AlertStage {
  const left = daysBetween(today, effectiveDeadline);
  if (left < 0) return 'overdue';
  const [d14, d7, d3] = THRESHOLDS.alertDays;
  if (left <= d3) return 'D-3';
  if (left <= d7) return 'D-7';
  if (left <= d14) return 'D-14';
  return null;
}
