import { ALERT_PLANS, recipientsFor, type AlertRow } from '../../src/workflow/alertPlan.js';

const row = (plan: 'current' | 'extended', days: number, kind = 'alert') =>
  ALERT_PLANS[plan].rows.find((r) => r.daysBefore === days && (r.kind ?? 'alert') === kind) as AlertRow;
const roles = (rs: { role: string }[]) => rs.map((r) => r.role).sort();

test('plans are data with version, assumption label and retroactive flag', () => {
  expect(Object.keys(ALERT_PLANS).sort()).toEqual(['current', 'extended']);
  for (const p of Object.values(ALERT_PLANS)) {
    expect(p.version).toMatch(/\d/);
    expect(p.labelKind).toBe('assumption');
  }
  expect(ALERT_PLANS.current.retroactive).toBe(true);
  expect(ALERT_PLANS.extended.retroactive).toBe(false);
});

test('current plan keeps D-14/7/3 and the D-3 escalation', () => {
  expect(ALERT_PLANS.current.rows.map((r) => `${r.daysBefore}:${r.kind ?? 'alert'}`)).toEqual(['14:alert', '7:alert', '3:alert', '3:escalation']);
  expect(row('current', 3, 'escalation').condition).toBe('undecided');
});

test('extended D-30 goes to marketing, finance and contract only', () => {
  expect(roles(recipientsFor(row('extended', 30), 'CEO_BOARD', { ready: true, parallel: false }))).toEqual(['contract', 'finance', 'marketing']);
});

test('extended D-14 adds the CEO of Masil with a decision request only when ready', () => {
  const ready = recipientsFor(row('extended', 14), 'CEO_BOARD', { ready: true, parallel: false });
  expect(ready.find((r) => r.role === 'masil_ceo')!.messageKey).toBe('decision_request');
  const notReady = recipientsFor(row('extended', 14), 'CEO_BOARD', { ready: false, parallel: false });
  expect(notReady.find((r) => r.role === 'masil_ceo')!.messageKey).toBe('not_ready_warning');
  expect(roles(ready)).not.toContain('ceo_board');
  expect(roles(recipientsFor(row('extended', 14), 'MARKETING', { ready: true, parallel: false }))).not.toContain('masil_ceo');
});

test('extended D-7 reaches the CEO/board only for CEO_BOARD cases; a parallel request makes it a pending reminder', () => {
  expect(roles(recipientsFor(row('extended', 7), 'MASIL_CEO_GROUP_REPORT', { ready: true, parallel: false }))).not.toContain('ceo_board');
  const ceo = recipientsFor(row('extended', 7), 'CEO_BOARD', { ready: false, parallel: false }).find((r) => r.role === 'ceo_board')!;
  expect(ceo.messageKey).toBe('not_ready_warning');
  const par = recipientsFor(row('extended', 7), 'CEO_BOARD', { ready: true, parallel: true }).find((r) => r.role === 'ceo_board')!;
  expect(par.messageKey).toBe('pending_reminder');
});

test('extended D-3 reaches every related role', () => {
  expect(roles(recipientsFor(row('extended', 3), 'CEO_BOARD', { ready: true, parallel: false })))
    .toEqual(['ceo_board', 'contract', 'finance', 'marketing', 'masil_ceo']);
  expect(roles(recipientsFor(row('extended', 3), 'MARKETING', { ready: true, parallel: false }))).toEqual(['contract', 'finance', 'marketing']);
});
