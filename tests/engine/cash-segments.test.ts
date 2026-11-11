import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS, SCENARIOS } from '../../src/engine/assumptions.js';
import { simulateCash, outflowInBreach } from '../../src/engine/cash.js';
import { previousBusinessDay } from '../../src/engine/calendar.js';
import type { Case } from '../../src/engine/cases.js';
import { routeCase } from '../../src/engine/routing.js';
import type { FullTables } from '../../src/engine/types.js';

const room = loadDataRoom();

/** 합성 자금 데이터: 마지막 실적 2026-06-30 종가 40억 원. */
function synth(ap: [string, number][], ar: [string, number][]): FullTables {
  return {
    cashDaily: [{ date: '2026-06-30', opening_balance: 4_000_000_000, inflow_krw: 0, outflow_krw: 0,
      closing_balance: 4_000_000_000, covenant_min_krw: 3_000_000_000, breach_flag: false }],
    arAging: ar.map(([due, amt], i) => ({ ar_id: `AR-${i}`, channel_id: 'CH-01', invoice_date: '2026-06-01',
      due_date: due, amount_krw: amt, outstanding_krw: amt, aging_days: 0 })),
    apAging: ap.map(([due, amt], i) => ({ ap_id: `AP-${i}`, supplier_id: 'S-1', po_id: null,
      invoice_date: '2026-06-01', payment_due_date: due, amount_krw: amt, aging_days: 0 })),
    purchaseOrders: [],
    cashForecast: [{ forecast_date: '2026-07-01', week: '2026-07-01', projected_inflow_krw: 0,
      projected_outflow_krw: 0, projected_closing_krw: 4_000_000_000 }],
  };
}

const planCase = (cashOutflowDate: string): Case => ({
  id: 'PLAN-X', kind: 'plan', influencerId: 'INF-002', campaignId: 'CMP-0004', amount: 5_000_000,
  amountScale: 'sample', deadline: '2026-08-14', settlementDate: cashOutflowDate, cashOutflowDate,
  effectiveDeadline: cashOutflowDate, executesBeforeDeadline: true, expectedGmv: 1, linkGroup: 'INF-002',
});

const twoSegments = () =>
  simulateCash(synth([['2026-07-02', 1_500_000_000], ['2026-07-09', 1_000_000_000]], [['2026-07-06', 1_000_000_000]]),
    DEFAULT_ASSUMPTIONS, '2026-07-10');

test('two disjoint breaches stay separate', () => {
  expect(twoSegments().breaches).toEqual([
    { start: '2026-07-02', end: '2026-07-03', businessDays: 2 },
    { start: '2026-07-09', end: '2026-07-10', businessDays: 2 },
  ]);
});

test('date between segments is not in breach and does not force CEO routing', () => {
  const { breaches } = twoSegments();
  expect(outflowInBreach('2026-07-07', breaches)).toBe(false);
  expect(outflowInBreach('2026-07-03', breaches)).toBe(true);
  expect(routeCase(planCase('2026-07-07'), { breaches, planTotal: 1 }).level).toBe('MARKETING');
  expect(routeCase(planCase('2026-07-09'), { breaches, planTotal: 1 }).level).toBe('CEO_BOARD');
});

test('weekend gap does not split a segment', () => {
  const r = simulateCash(synth([['2026-07-03', 1_500_000_000]], []), DEFAULT_ASSUMPTIONS, '2026-07-07');
  expect(r.breaches).toEqual([{ start: '2026-07-03', end: '2026-07-07', businessDays: 3 }]);
});

test('baseline and lc45 windows are unchanged', () => {
  expect(simulateCash(room.full, DEFAULT_ASSUMPTIONS).breaches)
    .toEqual([{ start: '2026-07-21', end: '2026-08-21', businessDays: 24 }]);
  expect(simulateCash(room.full, SCENARIOS.lc45).breaches).toEqual([]);
});

test('opening is the close of the business day before asOf', () => {
  const r = simulateCash(room.full, DEFAULT_ASSUMPTIONS);
  expect(r.opening).toBe(5148063540);
  expect(r.openingDate).toBe('2026-06-30');
});

test('opening coverage guard rejects gaps and overlap with actuals', () => {
  const full = synth([], []);
  expect(() => simulateCash(full, { ...DEFAULT_ASSUMPTIONS, asOf: '2026-07-02' })).toThrow(/기초 잔액/);
  expect(() => simulateCash(full, { ...DEFAULT_ASSUMPTIONS, asOf: '2026-06-30' })).toThrow(/기초 잔액/);
});

test('previousBusinessDay skips weekends', () => {
  expect(previousBusinessDay('2026-07-06')).toBe('2026-07-03');
  expect(previousBusinessDay('2026-07-01')).toBe('2026-06-30');
});
