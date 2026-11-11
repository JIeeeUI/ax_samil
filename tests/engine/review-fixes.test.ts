// 최종 검토에서 나온 중요 지적 6건의 회귀 테스트
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS } from '../../src/engine/assumptions.js';
import { simulateCash, outflowInBreach } from '../../src/engine/cash.js';
import { buildCases, planTotal } from '../../src/engine/cases.js';
import { routeCase } from '../../src/engine/routing.js';
import { buildIntake } from '../../src/engine/intake.js';
import type { DataRoom } from '../../src/engine/types.js';

const room = loadDataRoom();
const base = simulateCash(room.full, DEFAULT_ASSUMPTIONS);
const day = (r: ReturnType<typeof simulateCash>, d: string) => r.daily.find((x) => x.date === d)!.balance;

test('#1 contract above 10억 with unknown outflow still asks for the outflow date', () => {
  const cases = buildCases(room);
  const c = cases.find((x) => x.kind === 'contract')!;
  expect(routeCase(c, { breach: base.breach, planTotal: planTotal(cases) }))
    .toMatchObject({ level: 'CEO_BOARD', needsInfo: ['cash_outflow_date'] });
  const row = buildIntake(room, DEFAULT_ASSUMPTIONS).find((r) => r.제안ID === 'CONTRACT-INF-001')!;
  expect(row.필요정보).toBe('cash_outflow_date');
});

test('#2 past-due purchase order is placed on as-of, not dropped', () => {
  const full = { ...room.full, purchaseOrders: room.full.purchaseOrders.map((p, i) => (i === 0 ? { ...p, payment_due_date: '2026-06-25' } : p)) };
  const r = simulateCash(full, DEFAULT_ASSUMPTIONS);
  expect(day(base, '2026-07-01') - day(r, '2026-07-01')).toBe(524160000);
  expect(r.minimum.balance).toBe(base.minimum.balance);
});

test('#3 AP row whose po_id is not in the PO file is counted as an outflow', () => {
  const extra = { ...room.full.apAging[0], ap_id: 'MAP-TEST', po_id: 'SPO-9999', payment_due_date: '2026-07-10', amount_krw: 999000000 };
  const r = simulateCash({ ...room.full, apAging: [...room.full.apAging, extra] }, DEFAULT_ASSUMPTIONS);
  expect(base.minimum.balance - r.minimum.balance).toBe(999000000);
});

test('#4 weekend outflow rolls to Monday before the breach check', () => {
  const breach = { start: '2026-07-20', end: '2026-07-31', businessDays: 10 };
  expect(outflowInBreach('2026-07-18', breach)).toBe(true); // 토 → 월 7/20
  const cases = buildCases(room);
  const p = { ...cases.find((c) => c.id === 'PLAN-022')!, cashOutflowDate: '2026-07-18', amount: 5000000 };
  expect(routeCase(p, { breach, planTotal: 1 }).level).toBe('CEO_BOARD');
});

test('#7 zero requested amount gives blank expected ROAS, not Infinity', () => {
  const r: DataRoom = { ...room, sample: { ...room.sample, budgetPlan: room.sample.budgetPlan.map((p) => (p.plan_id === 'PLAN-025' ? { ...p, requested_budget_krw: 0 } : p)) } };
  const row = buildIntake(r, DEFAULT_ASSUMPTIONS).find((x) => x.제안ID === 'PLAN-025')!;
  expect(row.기안예상명목ROAS).toBe('');
});

test('#8 uncomputable ROAS is not ranked', () => {
  const r: DataRoom = { ...room, sample: { ...room.sample, adSpend: room.sample.adSpend.filter((a) => a.campaign_id !== 'CMP-0004') } };
  const row = buildIntake(r, DEFAULT_ASSUMPTIONS).find((x) => x.제안ID === 'PLAN-021')!; // PLAN-021 = CMP-0004
  expect(row.과거실질ROAS).toBe('');
  expect(row.명목순위).toBe('');
  expect(row.실질순위).toBe('');
});
