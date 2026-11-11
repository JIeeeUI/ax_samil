import { terminationPenalty } from '../../src/engine/contract.js';

test('penalty is 50% of the remaining fixed fee, prorated by month', () => {
  expect(terminationPenalty(2_800_000_000, '2026-09-01')).toBe(1_400_000_000);
  expect(terminationPenalty(2_800_000_000, '2027-02-15')).toBe(700_000_000);
  expect(terminationPenalty(900_000_000, '2026-09-01')).toBe(450_000_000);
  expect(terminationPenalty(1_800_000_000, '2027-08-20')).toBe(0);
  expect(terminationPenalty(1_800_000_000, '2026-07-10')).toBe(900_000_000);
});
