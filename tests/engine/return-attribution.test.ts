import { DEFAULT_ASSUMPTIONS, DEMAND_ONLY_VIEW, SCENARIOS } from '../../src/engine/assumptions.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { computeInfluencerPerformance, returnCauseSummary } from '../../src/engine/performance.js';

const room = loadDataRoom();
const byName = (a = DEFAULT_ASSUMPTIONS) => new Map(computeInfluencerPerformance(room, a).map((i) => [i.name, i]));

test('the default is "all": nothing changes', () => {
  expect(DEFAULT_ASSUMPTIONS.returnAttribution).toBe('all');
  const p = byName();
  expect(p.get('혜인')!.realRoas!).toBeCloseTo(-0.198, 2);
  expect(p.get('Ava Glow')!.realRoas!).toBeCloseTo(-0.214, 2);
});

test('demand-only view: wrong-shipment and defect returns leave the influencer result', () => {
  const p = byName(DEMAND_ONLY_VIEW);
  expect(p.get('혜인')!.realRoas!).toBeCloseTo(-0.11, 1);
  expect(p.get('Ava Glow')!.realRoas!).toBeCloseTo(-0.13, 1);
  // 둘 다 여전히 손실
  expect(p.get('혜인')!.realRoas!).toBeLessThan(0);
  expect(p.get('Ava Glow')!.realRoas!).toBeLessThan(0);
});

test('the three lowest keep their order', () => {
  for (const a of [DEFAULT_ASSUMPTIONS, DEMAND_ONLY_VIEW]) {
    const low = [...byName(a).values()].sort((x, y) => x.realRoas! - y.realRoas!).slice(0, 3).map((i) => i.name);
    expect(low).toEqual(['Ava Glow', '혜인', 'Lila SEA']);
  }
});

test('operational causes are 878 of 1,719 returns (about 51%)', () => {
  const s = returnCauseSummary(room);
  expect(s).toMatchObject({ total: 1719, operational: 878 });
  expect(Math.round(s.share * 100)).toBe(51);
});

test('the label says it is an assumption', () => {
  expect(DEMAND_ONLY_VIEW.labels.returnAttribution).toBe('assumption');
  expect(Object.keys(SCENARIOS)).not.toContain('demandOnly'); // 보기이지 가정 전환이 아니다
  expect(SCENARIOS.baseline.labels.returnAttribution).toBe('assumption');
});
