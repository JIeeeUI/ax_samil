import { DEFAULT_ASSUMPTIONS, SCENARIOS, THRESHOLDS } from '../../src/engine/assumptions.js';

test('baseline assumptions', () => {
  expect(DEFAULT_ASSUMPTIONS).toMatchObject({
    unitsPerOrder: 1, channelFeeBasis: 'gmv', recoverCostOnRefund: false, calcMode: 'a05',
    overdueAr: 'asof', overdueAp: 'asof', lc0001TermsDays: 90, asOf: '2026-07-01',
  });
  expect(SCENARIOS.lc45.lc0001TermsDays).toBe(45);
  expect(SCENARIOS.arOverdueExcluded.overdueAr).toBe('exclude');
  expect(SCENARIOS.bothOverdueExcluded).toMatchObject({ overdueAr: 'exclude', overdueAp: 'exclude' });
  expect(THRESHOLDS.covenantMinKrw).toBe(3000000000);
  expect(THRESHOLDS.perItemKrw).toBe(10000000);
  expect(THRESHOLDS.planTotalKrw).toBe(100000000);
  expect(THRESHOLDS.contractAnnualKrw).toBe(1000000000);
  expect(THRESHOLDS.boardDate).toBe('2026-07-06');
});

test('every assumption field has a label', () => {
  for (const s of Object.values(SCENARIOS)) {
    expect(Object.keys(s.labels).sort()).toEqual(
      ['calcMode', 'channelFeeBasis', 'lc0001TermsDays', 'overdueAp', 'overdueAr', 'recoverCostOnRefund', 'returnAttribution', 'unitsPerOrder']);
  }
  expect(SCENARIOS.baseline.labels.lc0001TermsDays).toBe('confirmed');
  expect(SCENARIOS.lc45.labels.lc0001TermsDays).toBe('assumption');
});
