import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS, SCENARIOS } from '../../src/engine/assumptions.js';
import { simulateCash } from '../../src/engine/cash.js';
import { buildCases, planTotal, type Case } from '../../src/engine/cases.js';
import { routeCase } from '../../src/engine/routing.js';

const room = loadDataRoom();
const cases = buildCases(room);
const breaches = simulateCash(room.full, DEFAULT_ASSUMPTIONS).breaches;
const total = planTotal(cases);
const byId = (id: string) => cases.find((c) => c.id === id)!;

test('baseline routing', () => {
  const routes = cases.map((c) => [c.id, routeCase(c, { breaches, planTotal: total })] as const);
  const ceoPlans = routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'CEO_BOARD');
  expect(ceoPlans).toHaveLength(12);
  expect(ceoPlans.reduce((s, [id]) => s + byId(id).amount, 0)).toBe(99550557);
  expect(routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'MASIL_CEO_GROUP_REPORT')).toHaveLength(13);
  expect(routes.find(([id]) => id === 'CONTRACT-INF-001')![1].level).toBe('CEO_BOARD');
  expect(routes.find(([id]) => id === 'PLAN-021')![1].level).toBe('CEO_BOARD'); // 집행 7/21 = 구간 시작일
  expect(routes.every(([, r]) => r.reasons.length > 0)).toBe(true);
});

test('lc45: no plan goes to CEO', () => {
  const b45 = simulateCash(room.full, SCENARIOS.lc45).breaches;
  expect(cases.filter((c) => c.kind === 'plan' && routeCase(c, { breaches: b45, planTotal: total }).level === 'CEO_BOARD'))
    .toHaveLength(0);
});

test('contract fee variants', () => {
  const contractOf = (cs: Case[]) => cs.find((c) => c.kind === 'contract')!;
  const c18 = contractOf(buildCases(room, { annualFixedFeeKrw: 1800000000 }));
  expect(routeCase(c18, { breaches, planTotal: total }).level).toBe('CEO_BOARD');
  const c9 = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000 }));
  const r9 = routeCase(c9, { breaches, planTotal: total });
  expect(r9).toMatchObject({ level: 'MASIL_CEO', needsInfo: ['cash_outflow_date', 'performance_fee_terms'] });
  expect(r9.reasons.join(' ')).toContain('성과 피 포함 시 10억 원 초과 여부 미확인: 잠정 경로');
  const c9in = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000, cashOutflowDate: '2026-08-03' }));
  expect(routeCase(c9in, { breaches, planTotal: total })).toMatchObject({ level: 'CEO_BOARD', needsInfo: [] });
  const c9out = contractOf(buildCases(room, { annualFixedFeeKrw: 900000000, cashOutflowDate: '2026-09-01' }));
  expect(routeCase(c9out, { breaches, planTotal: total })).toMatchObject({ level: 'MASIL_CEO', needsInfo: ['performance_fee_terms'] });
  // 10억 초과(28억·18억)는 성과 피와 무관하게 CEO/이사회라 추가 확인이 필요 없다.
  expect(routeCase(c18, { breaches, planTotal: total }).needsInfo).not.toContain('performance_fee_terms');
  expect(routeCase(contractOf(buildCases(room)), { breaches, planTotal: total }).needsInfo).toEqual(['cash_outflow_date']);
});

test('threshold boundaries', () => {
  const base: Case = { ...byId('PLAN-001'), cashOutflowDate: '2026-09-30' };
  expect(routeCase({ ...base, amount: 10000000 }, { breaches, planTotal: 100000000 }).level).toBe('MARKETING');
  expect(routeCase({ ...base, amount: 10000001 }, { breaches, planTotal: 100000000 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000 }, { breaches, planTotal: 100000001 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-21' }, { breaches, planTotal: 1 }).level).toBe('CEO_BOARD');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-24' }, { breaches, planTotal: 1 }).level).toBe('MARKETING');
});
