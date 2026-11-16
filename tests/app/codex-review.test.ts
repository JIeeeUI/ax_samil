import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const C = 'CONTRACT-INF-001';
async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return { svc, repo };
}
const submitted = async (svc: IntakeService) => { await svc.confirmFinance(C, 'finance'); await svc.submit(C, 'marketing'); };

test('R3: a hold due date must be a real calendar date and not in the past; nothing is saved when it is not', async () => {
  const { svc, repo } = await make();
  await submitted(svc);
  const hold = (dueDate: string) => ({ hold: { needed: '추가 검토', ownerRole: 'finance' as const, dueDate } });
  for (const bad of ['2026-99-99', '2026-02-30', '2026-13-01', '07/10', '', '2026-06-30']) {
    await expect(svc.decide(C, 'ceo_board', hold(bad))).rejects.toThrow(/HOLD_REQUIRES_OWNER_AND_DUE/);
  }
  expect((await svc.getCase(C)).item.status).toBe('submitted');
  expect((await repo.listInfoRequests({ caseId: C })).some((q) => q.needed === '추가 검토')).toBe(false);
  await svc.decide(C, 'ceo_board', hold('2026-07-08'));
  expect((await svc.getCase(C)).item.status).toBe('on_hold');
});

test('R3: the 1st-stage hold uses the same calendar check', async () => {
  const { svc } = await make();
  await svc.setConfig({ twoStage: true });
  await submitted(svc);
  await expect(svc.primaryHold(C, 'masil_ceo', { needed: 'x', ownerRole: 'finance', dueDate: '2026-02-30' })).rejects.toThrow(/HOLD_REQUIRES/);
});

test('R4: the opinion requirement is one server fact that the screen reads and the server enforces', async () => {
  const { svc } = await make();
  const fresh = (await svc.getCase('PLAN-001')).returnState;
  expect(fresh).toMatchObject({ allowed: true, opinionRequired: false, opinionNotice: null });
  await svc.advanceClock('2026-07-13'); // PLAN-001 실효 기한 7/17의 4일 전
  const near = (await svc.getCase('PLAN-001')).returnState;
  expect(near.allowed).toBe(false);
  expect(near.opinionRequired).toBe(true);
  expect(near.opinionNotice).toContain('의견');
  await expect(svc.confirmFinance('PLAN-001', 'finance')).rejects.toThrow(/OPINION_REQUIRED/);
  await expect(svc.confirmFinance('PLAN-001', 'finance', { opinion: '   ' })).rejects.toThrow(/OPINION_REQUIRED/);
  expect((await svc.getCase('PLAN-001')).item.status).toBe('finance_review');
  await svc.confirmFinance('PLAN-001', 'finance', { opinion: '기한이 임박해 반려 없이 상신' });
  expect((await svc.getCase('PLAN-001')).item.status).toBe('routed');
});

test('R4: the rule does not depend on the showExtended setting, and a used return round still requires it', async () => {
  const { svc } = await make();
  await svc.setConfig({ showExtended: false });
  await svc.advanceClock('2026-07-13');
  expect((await svc.getCase('PLAN-001')).returnState.opinionRequired).toBe(true);
  await expect(svc.confirmFinance('PLAN-001', 'finance')).rejects.toThrow(/OPINION_REQUIRED/);
  const b = await make();
  await b.svc.financeReturn('PLAN-001', 'finance', { reasons: ['cash_breach'], opinion: '현금 위험' });
  await b.svc.replyRevision('PLAN-001', 'marketing', { kind: 'adjust', text: '조정', amount: 5_000_000 });
  expect((await b.svc.getCase('PLAN-001')).returnState.opinionRequired).toBe(true);
  await expect(b.svc.confirmFinance('PLAN-001', 'finance')).rejects.toThrow(/OPINION_REQUIRED/);
});
