import { buildCases } from '../../src/engine/cases.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { ESCALATION_OPTIONS, linkWarnings, needsEscalation, stagesDue } from '../../src/workflow/guard.js';
import type { Status } from '../../src/workflow/status.js';

const cases = buildCases(loadDataRoom());
const DEADLINE = '2026-07-17'; // INF-001 전속계약 통보 기한

test('stages for the INF-001 contract (deadline 2026-07-17)', () => {
  expect(stagesDue('2026-07-02', DEADLINE)).toEqual([]);
  expect(stagesDue('2026-07-03', DEADLINE)).toEqual(['D-14']);
  expect(stagesDue('2026-07-10', DEADLINE)).toEqual(['D-14', 'D-7']);
  expect(stagesDue('2026-07-14', DEADLINE)).toEqual(['D-14', 'D-7', 'D-3']);
  expect(stagesDue('2026-07-17', DEADLINE)).toEqual(['D-14', 'D-7', 'D-3']);
  expect(stagesDue('2026-07-18', DEADLINE)).toEqual(['D-14', 'D-7', 'D-3', 'overdue']);
});

test('PLAN-007 effective deadline is its settlement date, not the fixed deadline', () => {
  const p = cases.find((c) => c.id === 'PLAN-007')!;
  expect(p.deadline).toBe('2026-08-14');
  expect(p.effectiveDeadline).toBe('2026-07-17');
  expect(stagesDue('2026-07-14', p.effectiveDeadline)).toContain('D-3');
});

test('escalation offers the three choices and only for undecided states', () => {
  expect(ESCALATION_OPTIONS).toEqual(['change_terms_notice', 'termination_notice', 'submit_then_approve']);
  for (const s of ['finance_review', 'routed', 'submitted', 'on_hold'] as Status[]) expect(needsEscalation(s)).toBe(true);
  for (const s of ['approved', 'rejected', 'overdue', 'closed'] as Status[]) expect(needsEscalation(s)).toBe(false);
});

const statuses = (plan: Status, contract: Status) =>
  new Map<string, Status>(cases.map((c) => [c.id, c.influencerId === 'INF-001' ? (c.kind === 'contract' ? contract : plan) : 'submitted']));

test('link warning appears when only the plan is rejected and the contract is undecided', () => {
  const w = linkWarnings(cases, statuses('rejected', 'submitted'));
  expect(w).toHaveLength(1);
  expect(w[0]).toMatchObject({ influencerId: 'INF-001' });
  expect(w[0].message).toContain('기안만 부결');
});

test('no link warning when the contract is decided or nothing is rejected', () => {
  expect(linkWarnings(cases, statuses('rejected', 'approved'))).toEqual([]);
  expect(linkWarnings(cases, statuses('submitted', 'submitted'))).toEqual([]);
});
