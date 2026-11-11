import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function fresh() {
  const db = await openDb({});
  const repo = new Repo(db);
  await repo.migrate();
  return { db, repo };
}

test('migrate is idempotent', async () => {
  const { repo } = await fresh();
  await expect(repo.migrate()).resolves.toBeUndefined();
});

test('events keep insertion order and jsonb snapshots round-trip', async () => {
  const { repo } = await fresh();
  const base = { caseId: 'PLAN-001', businessDate: '2026-07-01', actorRole: 'system', assumptionVersion: 'v1' };
  await repo.addEvent({ ...base, action: 'received', snapshot: { route: 'CEO_BOARD', n: [1, 2] } });
  await repo.addEvent({ ...base, action: 'calculated', simulated: true });
  const ev = await repo.listEvents('PLAN-001');
  expect(ev.map((e) => e.action)).toEqual(['received', 'calculated']);
  expect(ev[0].snapshot).toEqual({ route: 'CEO_BOARD', n: [1, 2] });
  expect(ev[1].simulated).toBe(true);
  expect(typeof ev[0].real_time).toBe('string');
});

test('insertAlertIfAbsent returns true once then false', async () => {
  const { repo } = await fresh();
  const a = { caseId: 'PLAN-001', stage: 'D-14', kind: 'alert', businessDate: '2026-07-01' };
  expect(await repo.insertAlertIfAbsent(a)).toBe(true);
  expect(await repo.insertAlertIfAbsent(a)).toBe(false);
  expect(await repo.insertAlertIfAbsent({ ...a, kind: 'escalation' })).toBe(true);
  expect((await repo.listAlerts('PLAN-001')).length).toBe(2);
});

test('dates are returned as YYYY-MM-DD strings', async () => {
  const { repo } = await fresh();
  await repo.setClock({ asOf: '2026-07-01', today: '2026-07-14' });
  expect(await repo.getClock()).toEqual({ asOf: '2026-07-01', today: '2026-07-14' });
  await repo.upsertState({ caseId: 'PLAN-001', status: 'submitted', routeLevel: 'CEO_BOARD', updatedBusinessDate: '2026-07-14' });
  expect((await repo.getState('PLAN-001'))?.updatedBusinessDate).toBe('2026-07-14');
});

test('state upsert replaces; settings and info requests round-trip; resetAll clears', async () => {
  const { repo } = await fresh();
  await repo.upsertState({ caseId: 'C', status: 'finance_review', routeLevel: 'MARKETING', updatedBusinessDate: '2026-07-01' });
  await repo.upsertState({ caseId: 'C', status: 'routed', routeLevel: 'MARKETING', updatedBusinessDate: '2026-07-02' });
  expect((await repo.listStates()).map((s) => s.status)).toEqual(['routed']);
  await repo.setSetting('contract', { annualFixedFeeKrw: 1 });
  expect(await repo.getSetting('contract')).toEqual({ annualFixedFeeKrw: 1 });
  const id = await repo.addInfoRequest({ caseId: 'C', needed: 'cash_outflow_date', ownerRole: 'finance', dueDate: '2026-07-04', createdDate: '2026-07-01' });
  await repo.updateInfoRequest(id, { status: 'replied', replyText: 'ok', replyValues: { cashOutflowDate: '2026-08-10' } });
  const got = await repo.getInfoRequest(id);
  expect(got).toMatchObject({ status: 'replied', replyValues: { cashOutflowDate: '2026-08-10' }, dueDate: '2026-07-04' });
  expect((await repo.listInfoRequests({ status: 'requested' })).length).toBe(0);
  await repo.resetAll();
  expect(await repo.listStates()).toEqual([]);
  expect(await repo.getClock()).toBeNull();
});

test('production without DATABASE_URL throws', async () => {
  await expect(openDb({ NODE_ENV: 'production' })).rejects.toThrow(/DATABASE_URL/);
});
