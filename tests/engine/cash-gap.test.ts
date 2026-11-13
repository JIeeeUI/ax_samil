import { SCENARIOS } from '../../src/engine/assumptions.js';
import { cashComparison, eok } from '../../src/engine/cashGap.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';

const room = loadDataRoom();

test('eok formats in units of 100 million won with one decimal', () => {
  expect(eok(5_468_884_369)).toBe('약 54.7억');
  expect(eok(1_647_835_595)).toBe('약 16.5억');
});

test('official forecast and recalculation are shown side by side and flagged for finance', () => {
  const g = cashComparison(room.full, SCENARIOS.baseline);
  expect(g.officialMinKrw).toBe(5_468_884_369);
  expect(g.recalcMinKrw).toBe(1_647_835_595);
  expect(g.recalcMinDate).toBe('2026-07-27');
  expect(g.officialBreach).toBe(false);
  expect(g.breaches).toEqual([expect.objectContaining({ start: '2026-07-21', end: '2026-08-21' })]);
  expect(g.needsFinanceCheck).toBe(true);
});

test('the only cause stated is the verified one: LC-0001 at 45 days removes the breach', () => {
  const g = cashComparison(room.full, SCENARIOS.baseline);
  expect(g.lc45RemovesBreach).toBe(true);
  expect(g.lines.join('\n')).toContain('LC-0001을 45일 조건으로 가정하면 공식 전망처럼 하회가 사라진다(재계산 결과)');
  expect(g.unverified.join('\n')).toContain('7/21 발주대금');
  expect(g.lines.join('\n')).not.toMatch(/때문|원인은/);
});

test('under the 45-day assumption there is nothing to flag', () => {
  const g = cashComparison(room.full, SCENARIOS.lc45);
  expect(g.breaches).toEqual([]);
  expect(g.needsFinanceCheck).toBe(false);
});
