import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS, SCENARIOS } from '../../src/engine/assumptions.js';
import { simulateCash } from '../../src/engine/cash.js';
import { buildCases, planTotal, type Case } from '../../src/engine/cases.js';
import { routeCase } from '../../src/engine/routing.js';

const room = loadDataRoom();
const cases = buildCases(room);
const breach = simulateCash(room.full, DEFAULT_ASSUMPTIONS).breach;
const total = planTotal(cases);
const byId = (id: string) => cases.find((c) => c.id === id)!;

test('baseline routing', () => {
  const routes = cases.map((c) => [c.id, routeCase(c, { breach, planTotal: total })] as const);
  const ceoPlans = routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'CEO_BOARD');
  expect(ceoPlans).toHaveLength(12);
  expect(ceoPlans.reduce((s, [id]) => s + byId(id).amount, 0)).toBe(99550557);
  expect(routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'MASIL_CEO_GROUP_REPORT')).toHaveLength(13);
  expect(routes.find(([id]) => id === 'CONTRACT-INF-001')![1].level).toBe('CEO_BOARD');
  expect(routes.find(([id]) => id === 'PLAN-021')![1].level).toBe('CEO_BOARD'); // 집행 7/21 = 구간 시작일
  expect(routes.every(([, r]) => r.reasons.length > 0)).toBe(true);
});

test('lc45: no plan goes to CEO', () => {
  const b45 = simulateCash(room.full, SCENARIOS.lc45).breach;
  expect(cases.filter((c) => c.kind === 'plan' && routeCase(c, { breach: b45, planTotal: total }).level === 'CEO_BOARD'))
    .toHaveLength(0);
});

test('contract fee variants', () => {
  const contractOf = (cs: Case[]) => cs.find((c) => c.kind === 'contract')!;
  const c18 = contractOf(buildCases(room, { annualFixedFeeKrw: 1800000000 }));
  expect(routeCase(c18, { breach, planTotal: total }).level).toBe('CEO_BOARD');
  const c9 = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000 }));
  expect(routeCase(c9, { breach, planTotal: total })).toMatchObject({ level: 'MASIL_CEO', needsInfo: ['cash_outflow_date'] });
  const c9in = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000, cashOutflowDate: '2026-08-03' }));
  expect(routeCase(c9in, { breach, planTotal: total })).toMatchObject({ level: 'CEO_BOARD', needsInfo: [] });
  const c9out = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000, cashOutflowDate: '2026-09-01' }));
  expect(routeCase(c9out, { breach, planTotal: total })).toMatchObject({ level: 'MASIL_CEO', needsInfo: [] });
});

test('threshold boundaries', () => {
  const base: Case = { ...byId('PLAN-001'), cashOutflowDate: '2026-09-30' };
  expect(routeCase({ ...base, amount: 10000000 }, { breach, planTotal: 100000000 }).level).toBe('MARKETING');
  expect(routeCase({ ...base, amount: 10000001 }, { breach, planTotal: 100000000 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000 }, { breach, planTotal: 100000001 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-21' }, { breach, planTotal: 1 }).level).toBe('CEO_BOARD');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-24' }, { breach, planTotal: 1 }).level).toBe('MARKETING');
});
