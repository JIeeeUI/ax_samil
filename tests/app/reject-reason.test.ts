import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const CONTRACT = 'CONTRACT-INF-001';
async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return svc;
}
const firstPlan = async (svc: IntakeService) => (await svc.listToday()).items.find((i) => i.kind === 'plan' && i.routeLevel === 'MASIL_CEO_GROUP_REPORT')!.id;

test('a rejection needs a reason; without it nothing changes', async () => {
  const svc = await make();
  const plan = await firstPlan(svc);
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await expect(svc.decide(plan, 'masil_ceo', { reject: { reason: '   ' } })).rejects.toThrow(/REASON_REQUIRED/);
  expect((await svc.getCase(plan)).item.status).toBe('submitted');
});

test('the reason is kept in the history and shown on the case', async () => {
  const svc = await make();
  const plan = await firstPlan(svc);
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await svc.decide(plan, 'masil_ceo', { reject: { reason: '광고비를 빼면 손해라서' } });
  const d = await svc.getCase(plan);
  expect(d.item.status).toBe('rejected');
  expect(d.rejection).toMatchObject({ reason: '광고비를 빼면 손해라서', actor: 'masil_ceo' });
  expect(d.events.find((e) => e.action === 'reject')!.detail).toMatchObject({ reason: '광고비를 빼면 손해라서' });
});

test('a rejection closes the open info requests and resubmission restarts at the finance check', async () => {
  const svc = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
  expect((await svc.getCase(CONTRACT)).requests.some((q) => q.status === 'requested')).toBe(true);
  await svc.decide(CONTRACT, 'masil_ceo', { reject: { reason: '조건이 불명확' } });
  expect((await svc.getCase(CONTRACT)).requests.filter((q) => q.status === 'requested')).toEqual([]);
  await svc.resubmit(CONTRACT, 'marketing');
  expect((await svc.getCase(CONTRACT)).item.status).toBe('finance_review');
  await svc.confirmFinance(CONTRACT, 'finance'); // 필요한 확인 요청만 다시 생긴다
  expect((await svc.getCase(CONTRACT)).requests.filter((q) => q.status === 'requested').length).toBeGreaterThan(0);
});

test('a 1st-stage return needs a reason too', async () => {
  const svc = await make();
  await svc.setConfig({ twoStage: true });
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
  await expect(svc.primaryReturn(CONTRACT, 'masil_ceo', '')).rejects.toThrow(/REASON_REQUIRED/);
  await svc.primaryReturn(CONTRACT, 'masil_ceo', '1차에서 조건 부족');
  expect((await svc.getCase(CONTRACT)).rejection).toMatchObject({ reason: '1차에서 조건 부족' });
});
