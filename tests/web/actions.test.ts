import { commands, decisionFromForm } from '../../src/app/commands.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function make() {
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  await svc.reset();
  return { svc, cmd: commands(svc) };
}
const CONTRACT = 'CONTRACT-INF-001';

test('a role without decision authority gets an error and the state does not change', async () => {
  const { svc, cmd } = await make();
  expect(await cmd.confirmFinance(CONTRACT, 'finance')).toEqual({ ok: true });
  expect(await cmd.submit(CONTRACT, 'marketing')).toEqual({ ok: true });
  const r = await cmd.decide(CONTRACT, 'masil_ceo', 'approve');
  expect(r).toMatchObject({ ok: false });
  expect((r as { error: string }).error).toMatch(/ROLE_NOT_ALLOWED/);
  expect((await svc.getCase(CONTRACT)).item.status).toBe('submitted');
});

test('moving the clock backwards returns an error', async () => {
  const { cmd } = await make();
  expect(await cmd.advanceClock('2026-07-10')).toEqual({ ok: true });
  const r = await cmd.advanceClock('2026-06-01');
  expect(r).toMatchObject({ ok: false });
  expect((r as { error: string }).error).toMatch(/CLOCK_BACKWARDS/);
});

test('a hold form without a due date is rejected', async () => {
  const { cmd } = await make();
  await cmd.confirmFinance(CONTRACT, 'finance');
  await cmd.submit(CONTRACT, 'marketing');
  const d = decisionFromForm({ decision: 'hold', holdNeeded: 'payment_schedule', holdOwner: 'finance', holdDue: '' });
  const r = await cmd.decide(CONTRACT, 'ceo_board', d);
  expect((r as { error: string }).error).toMatch(/HOLD_REQUIRES/);
});

test('reset restores 26 cases in finance_review and the baseline clock', async () => {
  const { svc, cmd } = await make();
  await cmd.advanceClock('2026-07-18');
  await cmd.reset();
  const v = await svc.listToday();
  expect(v.today).toBe('2026-07-01');
  expect(v.items).toHaveLength(26);
  expect(v.items.every((i) => i.status === 'finance_review')).toBe(true);
});

test('decisionFromForm parses approve, reject and a complete hold', () => {
  expect(decisionFromForm({ decision: 'approve' })).toBe('approve');
  expect(decisionFromForm({ decision: 'reject', rejectReason: '사유' })).toEqual({ reject: { reason: '사유' } });
  expect(decisionFromForm({ decision: 'hold', holdNeeded: 'x', holdOwner: 'finance', holdDue: '2026-07-04' }))
    .toEqual({ hold: { needed: 'x', ownerRole: 'finance', dueDate: '2026-07-04' } });
  expect(() => decisionFromForm({ decision: 'maybe' })).toThrow(/INVALID_DECISION/);
});
