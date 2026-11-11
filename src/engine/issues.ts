import { THRESHOLDS, type Label } from './assumptions.js';
import type { Case } from './cases.js';
import type { CampaignPerf, InfluencerPerf } from './performance.js';
import type { DataRoom } from './types.js';

export type IssueCode =
  | 'LOSS' | 'RETURN_RATE_WARN' | 'RETURN_RATE_ISSUE' | 'DISCOUNT_ABOVE_AVG' | 'ALLOCATION_INVERSION'
  | 'SAMPLE_TOO_SMALL' | 'EXECUTION_BEFORE_DEADLINE' | 'CONTRACT_OUTFLOW_UNKNOWN';

export interface Issue {
  targetType: 'campaign' | 'influencer' | 'case';
  targetId: string;
  code: IssueCode;
  severity: 'warn' | 'issue' | 'hold';
  evidence: string;
  label: Label;
}

/** ext_channel_benchmark: 채널 유형 → 반품률(%) (외부 벤치마크, Masil 실적 아님) */
export function channelReturnBenchmark(room: Pick<DataRoom, 'benchmarks'>): Record<string, number> {
  return Object.fromEntries(room.benchmarks.channel.map((b) => [b.channel_type, b.return_rate_pct]));
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const INVERSION_TOP_N = 3;

export function evaluateIssues(input: {
  campaigns: CampaignPerf[];
  influencers: InfluencerPerf[];
  cases: Case[];
  channelBenchmark: Record<string, number>;
}): Issue[] {
  const out: Issue[] = [];
  const { campaigns, influencers, cases, channelBenchmark } = input;

  const totGmv = campaigns.reduce((s, c) => s + c.gmv, 0);
  const totDisc = campaigns.reduce((s, c) => s + c.couponDiscount, 0);
  const avgDiscount = totGmv + totDisc === 0 ? 0 : totDisc / (totGmv + totDisc);

  for (const c of campaigns) {
    const id = c.campaignId;
    if (c.orders < THRESHOLDS.minOrders) {
      out.push({ targetType: 'campaign', targetId: id, code: 'SAMPLE_TOO_SMALL', severity: 'hold', label: 'assumption',
        evidence: `표본 주문 ${c.orders}건 < ${THRESHOLDS.minOrders}건: 판정 보류` });
      continue;
    }
    if (c.realRoas !== null && c.realRoas < 0) {
      out.push({ targetType: 'campaign', targetId: id, code: 'LOSS', severity: 'issue', label: 'confirmed',
        evidence: `실질 ROAS ${c.realRoas.toFixed(2)} (명목 ${c.nominalRoas?.toFixed(2)}): 마케팅비를 빼면 손실` });
    }
    const bench = channelBenchmark[c.salesChannelType];
    if (c.returnRate !== null && bench !== undefined) {
      const gap = c.returnRate * 100 - bench;
      if (gap > 0) {
        const code = gap > THRESHOLDS.returnIssuePp ? 'RETURN_RATE_ISSUE' : 'RETURN_RATE_WARN';
        out.push({ targetType: 'campaign', targetId: id, code, severity: code === 'RETURN_RATE_ISSUE' ? 'issue' : 'warn', label: 'benchmark',
          evidence: `반품률 ${pct(c.returnRate)} (${c.salesChannelType} 기준 ${bench.toFixed(1)}%, +${gap.toFixed(1)}%p)` });
      }
    }
    if (c.discountRate !== null && c.discountRate > avgDiscount) {
      out.push({ targetType: 'campaign', targetId: id, code: 'DISCOUNT_ABOVE_AVG', severity: 'warn', label: 'assumption',
        evidence: `쿠폰 할인율 ${pct(c.discountRate)} > 전체 평균 ${pct(avgDiscount)}` });
    }
  }

  const topRequest = [...influencers].sort((a, b) => b.requestShare - a.requestShare).slice(0, INVERSION_TOP_N);
  const bottomReal = influencers.filter((i) => i.realRoas !== null)
    .sort((a, b) => a.realRoas! - b.realRoas!).slice(0, INVERSION_TOP_N).map((i) => i.influencerId);
  for (const i of topRequest) {
    if (bottomReal.includes(i.influencerId)) {
      out.push({ targetType: 'influencer', targetId: i.influencerId, code: 'ALLOCATION_INVERSION', severity: 'issue', label: 'assumption',
        evidence: `${i.name}: 요청 비중 ${pct(i.requestShare)}(상위 ${INVERSION_TOP_N}) / 실질 ROAS ${i.realRoas!.toFixed(2)}(하위 ${INVERSION_TOP_N})` });
    }
  }

  for (const k of cases) {
    if (k.executesBeforeDeadline) {
      out.push({ targetType: 'case', targetId: k.id, code: 'EXECUTION_BEFORE_DEADLINE', severity: 'warn', label: 'assumption',
        evidence: `집행 예정일 ${k.settlementDate}이 확정기한 ${k.deadline}보다 빠름: 실효 결정 기한 ${k.effectiveDeadline}` });
    }
    if (k.kind === 'contract' && k.cashOutflowDate === null) {
      out.push({ targetType: 'case', targetId: k.id, code: 'CONTRACT_OUTFLOW_UNKNOWN', severity: 'hold', label: 'confirmed',
        evidence: '고정 피 지급 일정(현금 유출일)이 통보서에 없음: 하회 구간 해당 여부 미확인' });
    }
  }
  return out;
}
