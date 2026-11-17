import type { AssumptionSet } from './assumptions.js';
import type { DataRoom } from './types.js';

type PerfRoom = Pick<DataRoom, 'masters' | 'sample'>;

export interface CampaignPerf {
  campaignId: string;
  influencerId: string;
  /** m_campaign_ms.sales_channel (채널 유형) */
  salesChannelType: string;
  orders: number;
  gmv: number;
  refunds: number;
  couponDiscount: number;
  /** 공헌이익(마케팅비 차감 전) */
  contributionBeforeSpend: number;
  /** Marketing Spend = ad_cost_krw 합 */
  spend: number;
  nominalRoas: number | null;
  realRoas: number | null;
  returnRate: number | null;
  discountRate: number | null;
}

export interface InfluencerPerf {
  influencerId: string;
  name: string;
  feeType: string;
  tier: string;
  spend: number;
  spendShare: number;
  requested: number;
  requestShare: number;
  gmv: number;
  realRoas: number | null;
  nominalRoas: number | null;
  /** 1 = 실질 ROAS가 가장 높음. 실질 ROAS 계산 불가면 null */
  realRank: number | null;
}

/** 인플루언서 책임이 아니라고 보는 반품 사유 [가정] */
export const OPERATIONAL_RETURN_REASONS: readonly string[] = ['오배송', '불량'];

/** 반품 건수 중 운영·품질 원인(오배송·불량) 비중 */
export function returnCauseSummary(room: PerfRoom): { total: number; operational: number; share: number } {
  const total = room.sample.returns.length;
  const operational = room.sample.returns.filter((r) => OPERATIONAL_RETURN_REASONS.includes(r.reason)).length;
  return { total, operational, share: total === 0 ? 0 : operational / total };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

interface Acc { orders: number; gmv: number; refunds: number; coupon: number; cpBefore: number }

/** 캠페인별 누적(공헌이익 계산은 A05 5절 정의, 쿠폰·환불 이중 차감 없음). */
function accumulateByCampaign(room: PerfRoom, a: AssumptionSet): Map<string, Acc> {
  const refunds = new Map(room.sample.returns.map((r) => [r.order_id, r.refund_amount_krw]));
  const operational = new Set(room.sample.returns.filter((r) => OPERATIONAL_RETURN_REASONS.includes(r.reason)).map((r) => r.order_id));
  const cost = new Map(room.sample.costMaster.map((c) => [`${c.sku_id}|${c.channel_id}`, c]));
  const acc = new Map<string, Acc>();
  for (const o of room.sample.orders) {
    const k = cost.get(`${o.sku_id}|${o.channel_id}`);
    if (!k) throw new Error(`cost master missing for ${o.sku_id}|${o.channel_id}`);
    const g = o.gmv_krw;
    // 반품 원인 분리 보기: 오배송·불량 반품은 인플루언서 성과 계산에서 정상 판매로 본다(반품률 지표는 그대로).
    const excluded = a.returnAttribution === 'demandOnly' && operational.has(o.order_id);
    const returned = refunds.has(o.order_id) && !excluded;
    const r = excluded ? 0 : refunds.get(o.order_id) ?? 0;
    let productCost = k.product_cost_krw * a.unitsPerOrder;
    let fee = ((a.channelFeeBasis === 'gmv' ? g : g - r) * k.channel_fee_pct) / 100;
    if (a.recoverCostOnRefund && returned) { productCost = 0; fee = 0; }
    // 출고 물류비는 주문 1건당 1번(반품 물류비와 같은 규칙). 수량에 비례하는 것은 제품원가뿐이다.
    let cp = g - r - productCost - fee - k.shipping_cost_krw
      - (returned ? k.return_logistics_cost_krw : 0);
    if (a.calcMode === 'literal-calc-def') cp -= o.coupon_discount_krw + r;
    const x = acc.get(o.campaign_id) ?? { orders: 0, gmv: 0, refunds: 0, coupon: 0, cpBefore: 0 };
    x.orders += 1; x.gmv += g; x.refunds += refunds.get(o.order_id) ?? 0; x.coupon += o.coupon_discount_krw; x.cpBefore += cp;
    acc.set(o.campaign_id, x);
  }
  return acc;
}

function spendByCampaign(room: PerfRoom): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of room.sample.adSpend) m.set(s.campaign_id, (m.get(s.campaign_id) ?? 0) + s.ad_cost_krw);
  return m;
}

/**
 * 미리 계산한 캠페인 성과로 계산을 대신하는 장치(원본 행을 싣지 않는 정적 시연판용).
 * 인플루언서 성과는 이 캠페인 성과와 기안 표(요청 비중)로 다시 만들어지므로 따로 대신하지 않는다.
 */
export type CampaignPerformanceProvider = (a: AssumptionSet) => CampaignPerf[];
let campaignProvider: CampaignPerformanceProvider | null = null;
export function installCampaignPerformanceProvider(p: CampaignPerformanceProvider | null): void { campaignProvider = p; }

export function computeCampaignPerformance(room: PerfRoom, a: AssumptionSet): CampaignPerf[] {
  if (campaignProvider) return campaignProvider(a);
  const acc = accumulateByCampaign(room, a);
  const spend = spendByCampaign(room);
  return room.masters.campaigns.map((c) => {
    const x = acc.get(c.campaign_id) ?? { orders: 0, gmv: 0, refunds: 0, coupon: 0, cpBefore: 0 };
    const s = spend.get(c.campaign_id) ?? 0;
    return {
      campaignId: c.campaign_id,
      influencerId: c.influencer_id,
      salesChannelType: c.sales_channel,
      orders: x.orders,
      gmv: x.gmv,
      refunds: x.refunds,
      couponDiscount: x.coupon,
      contributionBeforeSpend: x.cpBefore,
      spend: s,
      nominalRoas: ratio(x.gmv, s),
      realRoas: ratio(x.cpBefore - s, s),
      returnRate: ratio(x.refunds, x.gmv),
      discountRate: ratio(x.coupon, x.gmv + x.coupon),
    };
  });
}

export function computeInfluencerPerformance(room: PerfRoom, a: AssumptionSet): InfluencerPerf[] {
  const camps = computeCampaignPerformance(room, a);
  const campToInf = new Map(room.masters.campaigns.map((c) => [c.campaign_id, c.influencer_id]));
  const requested = new Map<string, number>();
  for (const p of room.sample.budgetPlan) {
    const inf = campToInf.get(p.campaign_id)!;
    requested.set(inf, (requested.get(inf) ?? 0) + p.requested_budget_krw);
  }
  const totalSpend = camps.reduce((s, c) => s + c.spend, 0);
  const totalReq = [...requested.values()].reduce((s, v) => s + v, 0);
  const rows = room.masters.influencers.map((i) => {
    const mine = camps.filter((c) => c.influencerId === i.influencer_id);
    const spend = mine.reduce((s, c) => s + c.spend, 0);
    const gmv = mine.reduce((s, c) => s + c.gmv, 0);
    const cp = mine.reduce((s, c) => s + c.contributionBeforeSpend, 0);
    const req = requested.get(i.influencer_id) ?? 0;
    return {
      influencerId: i.influencer_id, name: i.influencer_name, feeType: i.fee_type, tier: i.tier,
      spend, spendShare: totalSpend === 0 ? 0 : spend / totalSpend,
      requested: req, requestShare: totalReq === 0 ? 0 : req / totalReq,
      gmv, realRoas: ratio(cp - spend, spend), nominalRoas: ratio(gmv, spend), realRank: null as number | null,
    };
  });
  const ranked = rows.filter((r) => r.realRoas !== null).sort((x, y) => y.realRoas! - x.realRoas!);
  ranked.forEach((r, idx) => { r.realRank = idx + 1; });
  return rows;
}

/** 주문 채널 유형별 반품률(금액 기준) = Σ반품환불 ÷ ΣGMV. */
export function returnRateByChannelType(room: PerfRoom): Record<string, number> {
  const type = new Map(room.masters.channels.map((c) => [c.channel_id, c.channel_type]));
  const refunds = new Map(room.sample.returns.map((r) => [r.order_id, r.refund_amount_krw]));
  const g = new Map<string, number>();
  const r = new Map<string, number>();
  for (const o of room.sample.orders) {
    const t = type.get(o.channel_id)!;
    g.set(t, (g.get(t) ?? 0) + o.gmv_krw);
    r.set(t, (r.get(t) ?? 0) + (refunds.get(o.order_id) ?? 0));
  }
  return Object.fromEntries([...g].map(([t, v]) => [t, (r.get(t) ?? 0) / v]));
}
