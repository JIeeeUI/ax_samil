import { verifyFacts } from '../../src/ai/verify.js';

const facts = (numbers: number[], dates: string[] = []) => ({ numbers, dates });

test('units and separators are normalised before matching', () => {
  expect(verifyFacts('고정 피 28억 원', facts([2_800_000_000]))).toEqual({ ok: true, unmatched: [] });
  expect(verifyFacts('요청액 180,803,272원', facts([180_803_272])).ok).toBe(true);
  expect(verifyFacts('건별 1천만 원 초과', facts([10_000_000])).ok).toBe(true);
});

test('a number the engine never produced is reported', () => {
  const r = verifyFacts('고정 피 35억 원', facts([2_800_000_000]));
  expect(r.ok).toBe(false);
  expect(r.unmatched).toEqual(['35억']);
});

test('dates must match known dates', () => {
  expect(verifyFacts('기한은 2026-07-17입니다', facts([], ['2026-07-17'])).ok).toBe(true);
  const r = verifyFacts('기한은 2026-07-18입니다', facts([], ['2026-07-17']));
  expect(r).toEqual({ ok: false, unmatched: ['2026-07-18'] });
});

test('rounding tolerance, percentages, ids and stage names', () => {
  expect(verifyFacts('실질 ROAS -0.21', facts([-0.2149])).ok).toBe(true);
  expect(verifyFacts('반품률 42.8%', facts([0.428])).ok).toBe(true);
  expect(verifyFacts('PLAN-007과 CONTRACT-INF-001은 D-3 알림', facts([])).ok).toBe(true);
});
