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
  return svc;
}
const toSubmitted = async (svc: IntakeService) => { await svc.confirmFinance(C, 'finance'); await svc.submit(C, 'marketing'); };
const notice = async (svc: IntakeService) => (await svc.getCase(C)).notice;

test('no notice before a decision, and plans never get one', async () => {
  const svc = await make();
  expect(await notice(svc)).toBeNull();
  const plan = (await svc.listToday()).items.find((i) => i.kind === 'plan' && i.routeLevel === 'MASIL_CEO_GROUP_REPORT')!.id;
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await svc.decide(plan, 'masil_ceo', 'approve');
  expect((await svc.getCase(plan)).notice).toBeNull();
});

test('rejection (no renewal) requires a termination notice: marketing sends, contract owner records', async () => {
  const svc = await make();
  await toSubmitted(svc);
  await svc.decide(C, 'ceo_board', { reject: { reason: '갱신하지 않음' } });
  expect(await notice(svc)).toMatchObject({ kind: 'terminate', required: true, dueDate: '2026-07-17', status: 'open' });
  await expect(svc.recordNotice(C, 'contract', { receiptProof: true })).rejects.toThrow(/NOTICE_NOT_SENT/);
  await expect(svc.sendNotice(C, 'finance', { kind: 'terminate', sentDate: '2026-07-01' })).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(svc.sendNotice(C, 'marketing', { kind: 'change', sentDate: '2026-07-01' })).rejects.toThrow(/NOTICE_KIND_MISMATCH/);
  await expect(svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '07/01' })).rejects.toThrow(/INVALID_DATE/);
  await svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' });
  expect(await notice(svc)).toMatchObject({ status: 'sent', sentDate: '2026-07-01' });
  await expect(svc.recordNotice(C, 'marketing', { receiptProof: true })).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await svc.recordNotice(C, 'contract', { receiptProof: false });
  expect(await notice(svc)).toMatchObject({ status: 'done', receiptProof: false, simulated: true });
  const acts = (await svc.getCase(C)).events.map((e) => e.action);
  expect(acts).toEqual(expect.arrayContaining(['notice_created', 'notice_sent', 'notice_recorded']));
});

test('approval with changed terms requires a change notice', async () => {
  const svc = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 1_800_000_000 });
  await toSubmitted(svc);
  await svc.decide(C, 'ceo_board', 'approve');
  expect(await notice(svc)).toMatchObject({ kind: 'change', required: true });
});

test('plain renewal needs no notice, only the renewal-confirmed record', async () => {
  const svc = await make();
  await toSubmitted(svc);
  await svc.decide(C, 'ceo_board', 'approve');
  expect(await notice(svc)).toMatchObject({ kind: 'renew_confirm', required: false, status: 'open' });
  await expect(svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' })).rejects.toThrow(/NOTICE_KIND_MISMATCH|NOTICE_NOT_REQUIRED/);
  await svc.recordNotice(C, 'contract', { receiptProof: false });
  expect(await notice(svc)).toMatchObject({ status: 'done' });
});

test('a resubmission voids the open notice of the rejected decision', async () => {
  const svc = await make();
  await toSubmitted(svc);
  await svc.decide(C, 'ceo_board', { reject: { reason: '재검토' } });
  await svc.resubmit(C, 'marketing');
  expect(await notice(svc)).toMatchObject({ status: 'void' });
});

test('undecided contract near the deadline warns that it renews automatically if not notified', async () => {
  const svc = await make();
  expect((await svc.getCase(C)).noticeWarning).toBeNull();
  await svc.advanceClock('2026-07-14');
  const d = await svc.getCase(C);
  expect(d.noticeWarning).toMatch(/자동 갱신/);
  const esc = d.alerts.find((a) => a.kind === 'escalation')!;
  expect(JSON.stringify(esc.payload)).toMatch(/자동 갱신/);
});
