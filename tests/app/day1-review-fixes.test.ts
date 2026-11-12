import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const P = 'PLAN-001';
const C = 'CONTRACT-INF-001';
async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return svc;
}
const ret = (svc: IntakeService, id = P) => svc.financeReturn(id, 'finance', { reasons: ['cash_breach'], opinion: '현금 위험' });
const status = async (svc: IntakeService, id = P) => (await svc.getCase(id)).item.status;

test('a consultation without a result is forwarded at the due date as unfinished', async () => {
  const svc = await make();
  await ret(svc);
  await svc.replyRevision(P, 'marketing', { kind: 'consult', text: '협의 필요' });
  expect(await status(svc)).toBe('consulting');
  await svc.advanceClock('2026-07-05');
  const d = await svc.getCase(P);
  expect(d.item.status).toBe('submitted');
  expect(JSON.stringify(d.events.find((e) => e.action === 'revision_unanswered')!.detail)).toContain('협의 미완료');
});

test('keep and the unanswered forward still create the info requests the contract needs', async () => {
  const a = await make();
  await ret(a, C);
  await a.replyRevision(C, 'marketing', { kind: 'keep', text: '변경 없음' });
  expect((await a.getCase(C)).requests.filter((q) => q.status === 'requested').length).toBeGreaterThan(0);
  const b = await make();
  await ret(b, C);
  await b.advanceClock('2026-07-05');
  expect(await status(b, C)).toBe('submitted');
  expect((await b.getCase(C)).requests.filter((q) => q.status === 'requested').length).toBeGreaterThan(0);
});

test('concurrent adjustments: the loser fails and the winner value stays', async () => {
  const svc = await make();
  await ret(svc);
  const r = await Promise.allSettled([
    svc.replyRevision(P, 'marketing', { kind: 'adjust', text: 'a', amount: 1_111_111 }),
    svc.replyRevision(P, 'marketing', { kind: 'adjust', text: 'b', amount: 2_222_222 }),
  ]);
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const amount = (await svc.getCase(P)).item.amount;
  expect([1_111_111, 2_222_222]).toContain(amount);
  expect((await svc.getCase(P)).adjustments).toHaveLength(1);
});

test('an adjusted date cannot be pulled to the immediate days (it would shorten the deadline)', async () => {
  const svc = await make();
  await ret(svc);
  await expect(svc.replyRevision(P, 'marketing', { kind: 'adjust', text: 'x', settlementDate: '2026-07-02' })).rejects.toThrow(/INVALID_ADJUSTMENT/);
  expect(await status(svc)).toBe('revision');
});

test('a 1st-stage return of the contract also requires a termination notice', async () => {
  const svc = await make();
  await svc.setConfig({ twoStage: true });
  await svc.confirmFinance(C, 'finance');
  await svc.submit(C, 'marketing');
  await svc.primaryReturn(C, 'masil_ceo', '1차 반려');
  expect((await svc.getCase(C)).notice).toMatchObject({ kind: 'terminate', required: true });
});

test('a sent notice is not voided by resubmission; the date must be between the decision and today', async () => {
  const svc = await make();
  await svc.confirmFinance(C, 'finance');
  await svc.submit(C, 'marketing');
  await svc.decide(C, 'ceo_board', { reject: { reason: '갱신 안 함' } });
  await expect(svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2020-01-01' })).rejects.toThrow(/INVALID_DATE/);
  await expect(svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-20' })).rejects.toThrow(/INVALID_DATE/);
  await svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' });
  await svc.resubmit(C, 'marketing');
  expect((await svc.getCase(C)).notice).toMatchObject({ status: 'sent' });
});

test('after a return the finance must attach an opinion to confirm', async () => {
  const svc = await make();
  await ret(svc);
  await svc.replyRevision(P, 'marketing', { kind: 'adjust', text: 'x', amount: 5_000_000 });
  await expect(svc.confirmFinance(P, 'finance')).rejects.toThrow(/OPINION_REQUIRED/);
  await svc.confirmFinance(P, 'finance', { opinion: '조정 확인' });
  expect(await status(svc)).toBe('routed');
});
