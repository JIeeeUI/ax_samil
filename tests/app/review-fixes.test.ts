import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const CONTRACT = 'CONTRACT-INF-001';
async function make(seed = true) {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  if (seed) await svc.reset();
  return { svc, repo };
}
const firstId = async (svc: IntakeService, level: string) =>
  (await svc.listToday()).items.find((i) => i.routeLevel === level && i.kind === 'plan')!.id;

test('final #1: two simultaneous approvals leave exactly one decision event', async () => {
  const { svc } = await make();
  const id = await firstId(svc, 'MASIL_CEO_GROUP_REPORT');
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  const r = await Promise.allSettled([svc.decide(id, 'masil_ceo', 'approve'), svc.decide(id, 'masil_ceo', 'approve')]);
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect((await svc.getCase(id)).events.filter((e) => e.action === 'approve')).toHaveLength(1);
});

test('final #1: two simultaneous holds create one info request', async () => {
  const { svc } = await make();
  const id = await firstId(svc, 'MASIL_CEO_GROUP_REPORT');
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  const hold = { hold: { needed: 'extra_data', ownerRole: 'marketing' as const, dueDate: '2026-07-04' } };
  await Promise.allSettled([svc.decide(id, 'masil_ceo', hold), svc.decide(id, 'masil_ceo', hold)]);
  expect((await svc.getCase(id)).requests.filter((q) => q.needed === 'extra_data')).toHaveLength(1);
});

test('final #2: a half-seeded database is re-seeded on initialisation', async () => {
  const { svc, repo } = await make(false);
  await repo.setClock({ asOf: '2026-07-01', today: '2026-07-01' });
  await svc.ensureInitialized();
  expect((await svc.listToday()).items).toHaveLength(26);
});

test('final #3: a reply on an approved contract is refused and its open requests are closed', async () => {
  const { svc } = await make();
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
  const open = (await svc.getCase(CONTRACT)).requests.find((q) => q.status === 'requested')!;
  await svc.decide(CONTRACT, 'ceo_board', 'approve');
  expect((await svc.getCase(CONTRACT)).requests.every((q) => q.status !== 'requested')).toBe(true);
  await expect(svc.replyInfoRequest(open.id, { text: 'x', values: { annualFixedFeeKrw: 900_000_000 }, simulated: true })).rejects.toThrow(/CASE_CLOSED|REQUEST_NOT_OPEN/);
  expect((await svc.getCase(CONTRACT)).penalty).toBe(1_400_000_000);
});

test('final #4: a decided case keeps showing the reasons it was decided on', async () => {
  const { svc } = await make();
  const id = await firstId(svc, 'CEO_BOARD');
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  await svc.decide(id, 'ceo_board', 'approve');
  await svc.setScenario('lc45');
  const d = await svc.getCase(id);
  expect(d.item.routeLevel).toBe('CEO_BOARD');
  expect(d.reasons.join(' ')).toContain('하회 구간');
});

test('final #5: a held plan can be released with a values-free resolution', async () => {
  const { svc } = await make();
  const id = await firstId(svc, 'MASIL_CEO_GROUP_REPORT');
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  await svc.decide(id, 'masil_ceo', { hold: { needed: 'extra_data', ownerRole: 'marketing', dueDate: '2026-07-04' } });
  const req = (await svc.getCase(id)).requests.find((q) => q.needed === 'extra_data')!;
  await svc.replyInfoRequest(req.id, { text: '추가 자료 첨부', simulated: true, resolved: true });
  const d = await svc.getCase(id);
  expect(d.item.status).toBe('routed');
  expect(d.requests.find((q) => q.id === req.id)!.status).toBe('replied');
});
