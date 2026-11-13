import { decisionRole } from '../../src/workflow/roles.js';
import { TERMINAL, transition, type Action, type Status } from '../../src/workflow/status.js';
import type { RouteLevel } from '../../src/engine/routing.js';

const T = '2026-07-01';
const st = (status: Status, routeLevel: RouteLevel = 'MASIL_CEO_GROUP_REPORT') => ({ status, routeLevel });

test('decisionRole maps routes to deciding roles', () => {
  expect(decisionRole('CEO_BOARD')).toBe('ceo_board');
  expect(decisionRole('MASIL_CEO_GROUP_REPORT')).toBe('masil_ceo');
  expect(decisionRole('MASIL_CEO')).toBe('masil_ceo');
  expect(decisionRole('MARKETING')).toBe('marketing');
});

test('happy path reaches approved', () => {
  let s: Status = 'finance_review';
  s = transition(st(s), 'confirm_finance', 'finance');
  expect(s).toBe('routed');
  s = transition(st(s), 'submit', 'marketing');
  expect(s).toBe('submitted');
  s = transition(st(s), 'approve', 'masil_ceo');
  expect(s).toBe('approved');
});

test('only the routed decision role may decide', () => {
  expect(() => transition(st('submitted', 'CEO_BOARD'), 'approve', 'masil_ceo')).toThrow(/ROLE_NOT_ALLOWED/);
  expect(transition(st('submitted', 'CEO_BOARD'), 'reject', 'ceo_board')).toBe('rejected');
});

test('only finance confirms and only marketing or finance submit', () => {
  expect(() => transition(st('finance_review'), 'confirm_finance', 'marketing')).toThrow(/ROLE_NOT_ALLOWED/);
  expect(() => transition(st('routed'), 'submit', 'contract')).toThrow(/ROLE_NOT_ALLOWED/);
});

test('hold requires owner role and a due date not before today', () => {
  const s = st('submitted');
  const ok = { needed: 'cash_outflow_date', ownerRole: 'finance' as const, dueDate: '2026-07-04' };
  expect(transition(s, 'hold', 'masil_ceo', { today: T, hold: ok })).toBe('on_hold');
  expect(() => transition(s, 'hold', 'masil_ceo', { today: T })).toThrow(/HOLD_REQUIRES/);
  expect(() => transition(s, 'hold', 'masil_ceo', { today: T, hold: { ...ok, dueDate: '' } })).toThrow(/HOLD_REQUIRES/);
  expect(() => transition(s, 'hold', 'masil_ceo', { today: T, hold: { ...ok, dueDate: '2026-06-30' } })).toThrow(/HOLD_REQUIRES/);
  expect(() => transition(s, 'hold', 'masil_ceo', { today: T, hold: { ...ok, ownerRole: undefined as never } })).toThrow(/HOLD_REQUIRES/);
  expect(() => transition(s, 'hold', 'masil_ceo', { today: T, hold: { ...ok, needed: ' ' } })).toThrow(/HOLD_REQUIRES/);
});

test('on_hold returns to routed after a reply', () => {
  expect(transition(st('on_hold'), 'reply', 'finance')).toBe('routed');
});

test('terminal states reject every action', () => {
  const actions: Action[] = ['confirm_finance', 'submit', 'approve', 'reject', 'hold', 'reply', 'resubmit', 'close', 'expire'];
  for (const status of ['approved', 'overdue', 'closed'] as Status[]) {
    expect(TERMINAL.has(status)).toBe(true);
    for (const a of actions) {
      expect(() => transition(st(status), a, a === 'expire' ? 'system' : 'masil_ceo')).toThrow(/INVALID_TRANSITION/);
    }
  }
});

test('rejected can be resubmitted or closed', () => {
  expect(transition(st('rejected'), 'resubmit', 'marketing')).toBe('finance_review');
  expect(transition(st('rejected'), 'close', 'marketing')).toBe('closed');
});

test('expire works from any non-terminal state and only for the system', () => {
  for (const status of ['finance_review', 'routed', 'submitted', 'on_hold', 'rejected'] as Status[]) {
    expect(transition(st(status), 'expire', 'system')).toBe('overdue');
  }
  expect(() => transition(st('submitted'), 'expire', 'masil_ceo')).toThrow(/ROLE_NOT_ALLOWED/);
});

test('an action out of order is an invalid transition', () => {
  expect(() => transition(st('finance_review'), 'approve', 'masil_ceo')).toThrow(/INVALID_TRANSITION/);
});
