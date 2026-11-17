import { SCENARIOS, type AssumptionSet } from '../engine/assumptions.js';
import { installCashProvider, simulateCash, type CashResult } from '../engine/cash.js';
import { computeCampaignPerformance, installCampaignPerformanceProvider, type CampaignPerf } from '../engine/performance.js';
import type { BudgetPlanRow, ChannelBenchmarkRow, DataRoom, IndustryBenchmarkRow, IsoDate, Masters } from '../engine/types.js';

/**
 * 원본 행(주문·반품·광고비·외상·발주 등)을 싣지 않고, 이 앱이 계산한 결과만 담은 데이터.
 * 정적 시연판(GitHub Pages)에서 서비스가 서버 없이 같은 계산 결과를 쓰게 한다.
 */
export interface DemoSnapshot {
  version: 1;
  /** 화면에 그대로 보이는 기안 표·마스터·외부 기준선(원본 행이 아니다) */
  room: {
    campaigns: Masters['campaigns'];
    influencers: Masters['influencers'];
    budgetPlan: BudgetPlanRow[];
    channelBenchmark: ChannelBenchmarkRow[];
    industryBenchmark: IndustryBenchmarkRow[];
  };
  /** perfKey → 캠페인 성과 */
  campaigns: Record<string, CampaignPerf[]>;
  /** cashKey → 일별 현금 재계산 결과 */
  cash: Record<string, CashResult>;
}

const DEFAULT_HORIZON: IsoDate = '2026-09-30';

/** 성과 계산 결과를 바꾸는 가정 전부 */
export function perfKey(a: AssumptionSet): string {
  return JSON.stringify([a.unitsPerOrder, a.channelFeeBasis, a.recoverCostOnRefund, a.calcMode, a.returnAttribution]);
}
/** 현금 재계산 결과를 바꾸는 가정 전부 */
export function cashKey(a: AssumptionSet, horizonEnd: IsoDate): string {
  return JSON.stringify([a.overdueAr, a.overdueAp, a.lc0001TermsDays, a.asOf, horizonEnd]);
}

/** 서비스가 실제로 쓰는 가정 조합: 시나리오 5개, 각각의 LC-0001 45일 비교, 반품 원인 분리 보기 */
function neededAssumptions(): { perf: AssumptionSet[]; cash: AssumptionSet[] } {
  const perf: AssumptionSet[] = [];
  const cash: AssumptionSet[] = [];
  for (const s of Object.values(SCENARIOS)) {
    perf.push(s, { ...s, returnAttribution: 'demandOnly' });
    cash.push(s, { ...s, lc0001TermsDays: 45 });
  }
  return { perf, cash };
}

export function buildSnapshot(real: DataRoom): DemoSnapshot {
  const need = neededAssumptions();
  const campaigns: DemoSnapshot['campaigns'] = {};
  const cash: DemoSnapshot['cash'] = {};
  for (const a of need.perf) campaigns[perfKey(a)] ??= computeCampaignPerformance(real, a);
  for (const a of need.cash) cash[cashKey(a, DEFAULT_HORIZON)] ??= simulateCash(real.full, a, DEFAULT_HORIZON);
  return {
    version: 1,
    room: {
      campaigns: real.masters.campaigns,
      influencers: real.masters.influencers,
      budgetPlan: real.sample.budgetPlan,
      channelBenchmark: real.benchmarks.channel,
      industryBenchmark: real.benchmarks.industry,
    },
    campaigns,
    cash,
  };
}

const missing = (what: string, key: string): Error =>
  new Error(`미리 계산하지 않은 가정입니다(${what} ${key}). 정적 시연판은 시나리오 5개와 그 비교 계산만 지원합니다`);

/** 스냅샷으로 계산을 대신하게 설치하고, 원본 행이 비어 있는 DataRoom을 돌려준다. */
export function installSnapshot(s: DemoSnapshot): DataRoom {
  installCampaignPerformanceProvider((a) => {
    const rows = s.campaigns[perfKey(a)];
    if (!rows) throw missing('성과', perfKey(a));
    return rows;
  });
  installCashProvider((a, horizonEnd) => {
    const r = s.cash[cashKey(a, horizonEnd)];
    if (!r) throw missing('현금', cashKey(a, horizonEnd));
    return r;
  });
  return {
    masters: { campaigns: s.room.campaigns, influencers: s.room.influencers, channels: [], skus: [] },
    sample: { orders: [], returns: [], coupons: [], adSpend: [], costMaster: [], budgetPlan: s.room.budgetPlan },
    full: { cashDaily: [], arAging: [], apAging: [], purchaseOrders: [], cashForecast: [] },
    benchmarks: { channel: s.room.channelBenchmark, industry: s.room.industryBenchmark },
  };
}

export function uninstallSnapshot(): void {
  installCampaignPerformanceProvider(null);
  installCashProvider(null);
}
