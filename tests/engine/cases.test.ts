import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { buildCases, planTotal, alertStage } from '../../src/engine/cases.js';

const room = loadDataRoom();
const cases = buildCases(room);

test('26 cases, total and links', () => {
  expect(cases).toHaveLength(26);
  expect(planTotal(cases)).toBe(180803272);
  expect(cases.filter((c) => c.linkGroup === 'INF-005' && c.kind === 'plan').map((c) => c.id).sort())
    .toEqual(['PLAN-005', 'PLAN-007', 'PLAN-009']);
  expect(cases.filter((c) => c.linkGroup === 'INF-001').map((c) => c.id).sort())
    .toEqual(['CONTRACT-INF-001', 'PLAN-001', 'PLAN-002', 'PLAN-003']);
});

test('effective deadline pulls 12 plans earlier', () => {
  expect(cases.filter((c) => c.executesBeforeDeadline).map((c) => c.id).sort()).toEqual([
    'PLAN-007', 'PLAN-008', 'PLAN-009', 'PLAN-014', 'PLAN-015', 'PLAN-016',
    'PLAN-018', 'PLAN-021', 'PLAN-022', 'PLAN-023', 'PLAN-024', 'PLAN-025',
  ]);
  expect(cases.find((c) => c.id === 'PLAN-007')!.effectiveDeadline).toBe('2026-07-17');
});

test('contract has no settlement or outflow date; effective deadline is notice deadline', () => {
  const c = cases.find((x) => x.id === 'CONTRACT-INF-001')!;
  expect(c).toMatchObject({
    kind: 'contract', amount: 2800000000, amountScale: 'full',
    settlementDate: null, cashOutflowDate: null, effectiveDeadline: '2026-07-17', executesBeforeDeadline: false,
  });
});

test('scale mix throws', () => {
  expect(() => planTotal([cases[0], { ...cases[0], amountScale: 'full' }])).toThrow('scale mix');
});

test('alert stages', () => {
  expect(alertStage('2026-07-01', '2026-07-17')).toBeNull();
  expect(alertStage('2026-07-03', '2026-07-17')).toBe('D-14');
  expect(alertStage('2026-07-10', '2026-07-17')).toBe('D-7');
  expect(alertStage('2026-07-14', '2026-07-17')).toBe('D-3');
  expect(alertStage('2026-07-17', '2026-07-17')).toBe('D-3');
  expect(alertStage('2026-07-18', '2026-07-17')).toBe('overdue');
});
