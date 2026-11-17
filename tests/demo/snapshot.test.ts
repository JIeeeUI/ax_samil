import { afterAll, beforeAll } from 'vitest';
import { SCENARIOS, type ScenarioId } from '../../src/engine/assumptions.js';
import { cashComparison } from '../../src/engine/cashGap.js';
import { simulateCash, installCashProvider } from '../../src/engine/cash.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { buildIntake } from '../../src/engine/intake.js';
import {
  computeCampaignPerformance, computeInfluencerPerformance, installCampaignPerformanceProvider,
} from '../../src/engine/performance.js';
import { buildSnapshot, installSnapshot, perfKey, cashKey, uninstallSnapshot } from '../../src/demo/snapshot.js';
import type { DataRoom } from '../../src/engine/types.js';

const real = loadDataRoom();
const ids = Object.keys(SCENARIOS) as ScenarioId[];
const TODAYS = ['2026-07-01', '2026-07-14', '2026-07-18'] as const;

// 원본으로 계산한 기대값을 설치 전에 모두 구해 둔다.
const expected = ids.map((id) => ({
  id,
  intake: TODAYS.map((t) => buildIntake(real, SCENARIOS[id], t)),
  gap: cashComparison(real.full, SCENARIOS[id]),
  cash: simulateCash(real.full, SCENARIOS[id]),
  camps: computeCampaignPerformance(real, SCENARIOS[id]),
  infs: computeInfluencerPerformance(real, SCENARIOS[id]),
  campsD: computeCampaignPerformance(real, { ...SCENARIOS[id], returnAttribution: 'demandOnly' }),
}));
const snap = buildSnapshot(real);
let slim: DataRoom;
beforeAll(() => { slim = installSnapshot(snap); });
afterAll(() => { uninstallSnapshot(); });

test('providers are replaceable and removable', () => {
  const marker = { opening: 1 } as never;
  installCashProvider(() => marker);
  expect(simulateCash(real.full, SCENARIOS.baseline)).toBe(marker);
  installCashProvider(null);
  expect(simulateCash(real.full, SCENARIOS.baseline).opening).toBe(5148063540);
  installCampaignPerformanceProvider(() => []);
  expect(computeCampaignPerformance(real, SCENARIOS.baseline)).toEqual([]);
  installCampaignPerformanceProvider(null);
  expect(computeCampaignPerformance(real, SCENARIOS.baseline)).toHaveLength(25);
  installSnapshot(snap); // 다른 테스트를 위해 다시 설치
});

for (const e of expected) {
  test(`snapshot reproduces the engine exactly: ${e.id}`, () => {
    const s = SCENARIOS[e.id];
    TODAYS.forEach((t, i) => expect(buildIntake(slim, s, t)).toEqual(e.intake[i]));
    expect(cashComparison(slim.full, s)).toEqual(e.gap);
    expect(simulateCash(slim.full, s)).toEqual(e.cash);
    expect(computeCampaignPerformance(slim, s)).toEqual(e.camps);
    expect(computeInfluencerPerformance(slim, s)).toEqual(e.infs);
    expect(computeCampaignPerformance(slim, { ...s, returnAttribution: 'demandOnly' })).toEqual(e.campsD);
  });
}

test('influencer request shares follow the (possibly adjusted) budget plan, not a frozen copy', () => {
  const adjusted: DataRoom = {
    ...slim,
    sample: { ...slim.sample, budgetPlan: slim.sample.budgetPlan.map((p) => (p.plan_id === 'PLAN-001' ? { ...p, requested_budget_krw: 1 } : p)) },
  };
  const realAdjusted: DataRoom = {
    ...real,
    sample: { ...real.sample, budgetPlan: real.sample.budgetPlan.map((p) => (p.plan_id === 'PLAN-001' ? { ...p, requested_budget_krw: 1 } : p)) },
  };
  const want = computeInfluencerPerformance(realAdjusted, SCENARIOS.baseline);
  installSnapshot(snap);
  expect(computeInfluencerPerformance(adjusted, SCENARIOS.baseline)).toEqual(want);
});

test('assumptions that were not precomputed fail loudly instead of returning zeros', () => {
  expect(() => computeCampaignPerformance(slim, { ...SCENARIOS.baseline, unitsPerOrder: 7 })).toThrow('미리 계산');
  expect(() => simulateCash(slim.full, { ...SCENARIOS.baseline, asOf: '2026-08-03' })).toThrow('미리 계산');
  expect(() => simulateCash(slim.full, SCENARIOS.baseline, '2026-12-31')).toThrow('미리 계산');
});

test('keys cover every scenario and its lc45 / demand-only variants', () => {
  for (const id of ids) {
    const s = SCENARIOS[id];
    expect(snap.cash[cashKey({ ...s, lc0001TermsDays: 45 }, '2026-09-30')]).toBeDefined();
    expect(snap.cash[cashKey(s, '2026-09-30')]).toBeDefined();
    expect(snap.campaigns[perfKey({ ...s, returnAttribution: 'demandOnly' })]).toBeDefined();
  }
});

test('the snapshot carries results, not raw rows', () => {
  const text = JSON.stringify(snap);
  for (const rawId of ['MO-00', 'RT-00', 'AD-00', 'CP-00', 'MAR-', 'MAP-', 'SPO-', 'CU-00']) expect(text).not.toContain(rawId);
  expect(text.length).toBeLessThan(400_000);
  expect(slim.sample.orders).toHaveLength(0);
  expect(slim.sample.returns).toHaveLength(0);
  expect(slim.sample.adSpend).toHaveLength(0);
  expect(slim.full.arAging).toHaveLength(0);
  expect(slim.full.cashDaily).toHaveLength(0);
  expect(slim.sample.budgetPlan).toHaveLength(25);
});
