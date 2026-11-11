import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS, type AssumptionSet } from '../../src/engine/assumptions.js';
import {
  computeCampaignPerformance, computeInfluencerPerformance, returnRateByChannelType,
} from '../../src/engine/performance.js';

const room = loadDataRoom();
const NEG6 = ['CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0012', 'CMP-0013', 'CMP-0014'];
const neg = (a: AssumptionSet) =>
  computeCampaignPerformance(room, a).filter((c) => c.realRoas! < 0).map((c) => c.campaignId).sort();

test('baseline: six loss-making campaigns', () => {
  expect(neg(DEFAULT_ASSUMPTIONS)).toEqual(NEG6);
});

test('robust to cost assumptions', () => {
  const variants: Partial<AssumptionSet>[] = [
    { channelFeeBasis: 'net' }, { recoverCostOnRefund: true }, { channelFeeBasis: 'net', recoverCostOnRefund: true },
  ];
  for (const v of variants) expect(neg({ ...DEFAULT_ASSUMPTIONS, ...v })).toEqual(NEG6);
});

test('literal calc-def double subtraction gives 11 (regression: engine must not use it by default)', () => {
  expect(neg({ ...DEFAULT_ASSUMPTIONS, calcMode: 'literal-calc-def' })).toEqual([
    'CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0007', 'CMP-0008', 'CMP-0012',
    'CMP-0013', 'CMP-0014', 'CMP-0017', 'CMP-0018', 'CMP-0019',
  ]);
});

test('influencer real ROAS and shares', () => {
  const by = Object.fromEntries(computeInfluencerPerformance(room, DEFAULT_ASSUMPTIONS).map((i) => [i.influencerId, i]));
  // 사전 계산은 소수 둘째 자리(ROAS)·퍼센트 첫째 자리(비중)까지만 확인했으므로 그 정밀도로 고정
  expect(by['INF-001'].realRoas).toBeCloseTo(-0.20, 1);
  expect(by['INF-005'].realRoas).toBeCloseTo(-0.21, 1);
  expect(by['INF-002'].realRoas).toBeCloseTo(3.70, 1);
  expect(by['INF-001'].realRoas!).toBeLessThan(0);
  expect(by['INF-001'].spendShare).toBeCloseTo(0.406, 2);
  expect(by['INF-005'].spendShare).toBeCloseTo(0.221, 2);
  expect(by['INF-001'].requestShare).toBeCloseTo(0.280, 2);
  expect(by['INF-003'].requestShare).toBeCloseTo(0.151, 2);
  expect(by['INF-002'].realRank).toBe(1);
});

test('return rate by channel type', () => {
  const r = returnRateByChannelType(room);
  expect(r['자사몰']).toBeCloseTo(0.040, 2);
  expect(r['마켓플레이스']).toBeCloseTo(0.099, 2);
  expect(r['대형파트너']).toBeCloseTo(0.129, 2);
  expect(r['라이브']).toBeCloseTo(0.130, 2);
});

test('zero spend gives null ROAS, not Infinity', () => {
  const noSpend = { ...room, sample: { ...room.sample, adSpend: room.sample.adSpend.filter((a) => a.campaign_id !== 'CMP-0004') } };
  const r = computeCampaignPerformance(noSpend, DEFAULT_ASSUMPTIONS).find((c) => c.campaignId === 'CMP-0004')!;
  expect(r.realRoas).toBeNull();
  expect(r.nominalRoas).toBeNull();
});
