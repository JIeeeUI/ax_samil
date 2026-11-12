import { nextStep } from '../../app/plain.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const CONTRACT = 'CONTRACT-INF-001';
async function make(cfg: Parameters<IntakeService['setConfig']>[0] = {}) {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  if (Object.keys(cfg).length) await svc.setConfig(cfg);
  return { svc, repo };
}
const submitContract = async (svc: IntakeService) => {
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
};
const hold = (needed: string, dueDate: string) => ({ needed, ownerRole: 'finance' as const, dueDate });
const open = async (svc: IntakeService) => (await svc.getCase(CONTRACT)).requests.filter((q) => q.status === 'requested');
const actions = async (svc: IntakeService) => (await svc.getCase(CONTRACT)).events.map((e) => e.action);

test('review #1: prototype keys are not valid plans or scenarios', async () => {
  const { svc } = await make();
  await expect(svc.setConfig({ alertPlan: 'toString' as never })).rejects.toThrow(/INVALID_CONFIG/);
  await expect(svc.setConfig({ alertPlan: 'constructor' as never })).rejects.toThrow(/INVALID_CONFIG/);
  await expect(svc.setScenario('toString' as never)).rejects.toThrow(/UNKNOWN_SCENARIO/);
});

test('review #2: submitting inside the urgent window sends the parallel request at once', async () => {
  const { svc } = await make({ twoStage: true });
  await svc.advanceClock('2026-07-08'); // 마감까지 9일, 아직 상신 전
  await submitContract(svc);
  const d = await svc.getCase(CONTRACT);
  expect(d.review).toMatchObject({ state: 'pending', parallel: true });
  await svc.decide(CONTRACT, 'ceo_board', 'approve'); // 다시 날짜를 넘기지 않아도 CEO가 결정할 수 있다
  expect((await svc.getCase(CONTRACT)).item.status).toBe('approved');
});

test('review #2: switching the feature on inside the urgent window also sends it', async () => {
  const { svc } = await make();
  await submitContract(svc);
  await svc.advanceClock('2026-07-08');
  await svc.setConfig({ twoStage: true });
  expect((await svc.getCase(CONTRACT)).review).toMatchObject({ parallel: true });
});

test('review #3: a 1st-stage hold whose request is closed by a same-topic reply is released', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc); // confirmFinance가 cash_outflow_date 확인 요청을 이미 만든다
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('cash_outflow_date', '2026-07-10'));
  const auto = (await open(svc)).find((q) => q.dueDate !== '2026-07-10')!;
  await svc.replyInfoRequest(auto.id, { text: '8/10 지급', values: { cashOutflowDate: '2026-08-10' }, simulated: true });
  expect((await svc.getCase(CONTRACT)).review).toMatchObject({ state: 'pending', holdDue: null });
});

test('review #4: escalating from a hold closes the hold request', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10'));
  await svc.primaryEscalate(CONTRACT, 'masil_ceo');
  expect((await open(svc)).some((q) => q.needed === 'payment_schedule')).toBe(false);
});

test('review #5: when the CEO decides first, the 1st-stage hold request is closed too', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10'));
  await svc.advanceClock('2026-07-07');
  await svc.decide(CONTRACT, 'ceo_board', 'reject');
  expect((await svc.getCase(CONTRACT)).review!.state).toBe('closed_parallel');
  expect((await open(svc)).some((q) => q.needed === 'payment_schedule')).toBe(false);
});

test('review #5: a CEO hold is not a decision, and answering the 1st-stage request does not release the CEO hold', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10'));
  await svc.advanceClock('2026-07-07');
  const a = (await open(svc)).find((q) => q.needed === 'payment_schedule')!;
  await svc.decide(CONTRACT, 'ceo_board', { hold: hold('board_question', '2026-07-09') });
  let d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('on_hold');
  expect(d.review!.state).not.toBe('closed_parallel'); // CEO 보류는 결정이 아니므로 1차를 닫지 않는다
  await svc.replyInfoRequest(a.id, { text: '자료 첨부', simulated: true, resolved: true });
  d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('on_hold'); // CEO의 질문(board_question)은 아직 답이 없다
  const b = (await open(svc)).find((q) => q.needed === 'board_question')!;
  await svc.replyInfoRequest(b.id, { text: '답변', simulated: true, resolved: true });
  // 계약에는 자동 생성된 현금 유출일 확인 요청도 열려 있어, 열린 요청이 모두 답변될 때까지 보류가 유지된다.
  expect((await svc.getCase(CONTRACT)).item.status).toBe('on_hold');
  const auto = (await open(svc)).find((q) => q.needed === 'cash_outflow_date')!;
  await svc.replyInfoRequest(auto.id, { text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect((await svc.getCase(CONTRACT)).item.status).toBe('routed');
});

test('review #6: simultaneous 1st-stage calls take effect once', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  const esc = await Promise.allSettled([svc.primaryEscalate(CONTRACT, 'masil_ceo'), svc.primaryEscalate(CONTRACT, 'masil_ceo')]);
  expect(esc.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await actions(svc)).filter((a) => a === 'primary_escalate')).toHaveLength(1);
});

test('review #6: simultaneous 1st-stage holds create one request', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await Promise.allSettled([
    svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10')),
    svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10')),
  ]);
  expect((await open(svc)).filter((q) => q.needed === 'payment_schedule')).toHaveLength(1);
});

test('review #6: a CEO decision racing a 1st-stage hold never leaves an open request on the decided case', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.advanceClock('2026-07-07');
  await Promise.allSettled([
    svc.decide(CONTRACT, 'ceo_board', 'approve'),
    svc.primaryHold(CONTRACT, 'masil_ceo', hold('payment_schedule', '2026-07-10')),
  ]);
  const d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('approved');
  expect(d.requests.filter((q) => q.needed === 'payment_schedule' && q.status === 'requested')).toHaveLength(0);
});

test('review #6: two simultaneous clock moves to the urgent date raise the parallel request once', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  const r = await Promise.all([svc.advanceClock('2026-07-07'), svc.advanceClock('2026-07-07')]);
  expect(r.flatMap((x) => x.raised).filter((x) => x.kind === 'parallel' && x.caseId === CONTRACT)).toHaveLength(1);
  expect((await actions(svc)).filter((a) => a === 'parallel_escalate')).toHaveLength(1);
});

test('review #7: the CEO of Masil sees the 1st stage as theirs and the CEO/board sees it as waiting', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  const item = (await svc.listToday()).items.find((i) => i.id === CONTRACT)!;
  expect(item.primaryPending).toBe(true);
  expect(nextStep(item, 'masil_ceo').kind).toBe('mine');
  expect(nextStep(item, 'ceo_board').kind).toBe('waiting');
  await svc.primaryEscalate(CONTRACT, 'masil_ceo');
  const after = (await svc.listToday()).items.find((i) => i.id === CONTRACT)!;
  expect(after.primaryPending).toBe(false);
  expect(nextStep(after, 'ceo_board').kind).toBe('mine');
});

test('review #8: a stale 1st-stage row does not survive a route change', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryEscalate(CONTRACT, 'masil_ceo');
  await svc.proposeContractChange({ annualFixedFeeKrw: 900_000_000 }); // CEO_BOARD → 대표 경로
  expect((await svc.getCase(CONTRACT)).item.routeLevel).toBe('MASIL_CEO');
  await svc.proposeContractChange({ annualFixedFeeKrw: 2_800_000_000 }); // 다시 CEO_BOARD
  const d = await svc.getCase(CONTRACT);
  expect(d.item.routeLevel).toBe('CEO_BOARD');
  expect(d.review!.state).toBe('pending'); // 1차를 건너뛰지 않는다
});
