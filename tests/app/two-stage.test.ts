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
const hold = (dueDate: string) => ({ needed: 'payment_schedule', ownerRole: 'finance' as const, dueDate });
const actions = async (svc: IntakeService, id = CONTRACT) => (await svc.getCase(id)).events.map((e) => e.action);

// ---------- 1차/2차 결재 ----------
test('default config: two-stage off, urgent 10 days, hold cap 3 days, plan current; no review block', async () => {
  const { svc } = await make();
  expect(await svc.getConfig()).toMatchObject({ twoStage: false, urgentDays: 10, holdCapDays: 3, alertPlan: 'current' });
  await submitContract(svc);
  expect((await svc.getCase(CONTRACT)).review).toBeNull();
  await svc.decide(CONTRACT, 'ceo_board', 'approve'); // 기존 1단계 흐름 그대로
  expect((await svc.getCase(CONTRACT)).item.status).toBe('approved');
});

test('invalid config values are rejected', async () => {
  const { svc } = await make();
  await expect(svc.setConfig({ urgentDays: 0 })).rejects.toThrow(/INVALID_CONFIG/);
  await expect(svc.setConfig({ holdCapDays: -1 })).rejects.toThrow(/INVALID_CONFIG/);
  await expect(svc.setConfig({ alertPlan: 'nope' as never })).rejects.toThrow(/INVALID_CONFIG/);
});

test('two-stage on: the CEO of Masil cannot finalise a CEO_BOARD case, and the CEO cannot decide before the 2nd stage is requested', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await expect(svc.decide(CONTRACT, 'masil_ceo', 'approve')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(svc.decide(CONTRACT, 'ceo_board', 'approve')).rejects.toThrow(/SECOND_STAGE_NOT_REQUESTED/);
  expect((await svc.getCase(CONTRACT)).review).toMatchObject({ state: 'pending', parallel: false });
  await svc.primaryEscalate(CONTRACT, 'masil_ceo');
  expect((await svc.getCase(CONTRACT)).review!.state).toBe('escalated');
  await svc.decide(CONTRACT, 'ceo_board', 'approve');
  expect((await svc.getCase(CONTRACT)).item.status).toBe('approved');
  expect(await actions(svc)).toEqual(expect.arrayContaining(['primary_escalate', 'approve']));
});

test('only the CEO of Masil performs the 1st stage and only on a submitted CEO_BOARD case', async () => {
  const { svc } = await make({ twoStage: true });
  await expect(svc.primaryEscalate(CONTRACT, 'masil_ceo')).rejects.toThrow(/INVALID_TRANSITION|PRIMARY_NOT_AVAILABLE/);
  await submitContract(svc);
  await expect(svc.primaryEscalate(CONTRACT, 'ceo_board')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  const plan = (await svc.listToday()).items.find((i) => i.kind === 'plan' && i.routeLevel === 'MASIL_CEO_GROUP_REPORT')!.id;
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await expect(svc.primaryEscalate(plan, 'masil_ceo')).rejects.toThrow(/PRIMARY_NOT_AVAILABLE/);
  await svc.decide(plan, 'masil_ceo', 'approve'); // 다른 경로는 1단계 그대로
  expect((await svc.getCase(plan)).item.status).toBe('approved');
});

test('1st-stage hold needs owner and due, and the due may not pass deadline minus 3 days', async () => {
  const { svc } = await make({ twoStage: true }); // 마감 7/17 → 상한 7/14
  await submitContract(svc);
  await expect(svc.primaryHold(CONTRACT, 'masil_ceo', { needed: 'x', ownerRole: 'finance', dueDate: '' })).rejects.toThrow(/HOLD_REQUIRES/);
  await expect(svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-15'))).rejects.toThrow(/PRIMARY_HOLD_LIMIT/);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-14'));
  const d = await svc.getCase(CONTRACT);
  expect(d.review).toMatchObject({ state: 'held', holdDue: '2026-07-14' });
  expect(d.item.status).toBe('submitted'); // 보류해도 상태·시계는 그대로
  expect(d.requests.find((q) => q.needed === 'payment_schedule')).toMatchObject({ ownerRole: 'finance', dueDate: '2026-07-14' });
  await expect(svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-10'))).rejects.toThrow(/PRIMARY_ALREADY_HELD/);
});

test('after the cap date the 1st-stage hold cannot be created at all', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.advanceClock('2026-07-15');
  await expect(svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-16'))).rejects.toThrow(/PRIMARY_HOLD_NOT_ALLOWED/);
});

test('urgent (10 days or fewer): a pending or held 1st stage triggers a parallel request to the CEO; the clock never stops', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-14'));
  const early = await svc.advanceClock('2026-07-06'); // 마감까지 11일
  expect(early.raised.some((r) => r.kind === 'parallel')).toBe(false);
  expect((await svc.getCase(CONTRACT)).review!.parallel).toBe(false);
  const urgent = await svc.advanceClock('2026-07-07'); // 마감까지 10일
  expect(urgent.raised).toContainEqual({ caseId: CONTRACT, stage: 'parallel', kind: 'parallel' });
  const d = await svc.getCase(CONTRACT);
  expect(d.review).toMatchObject({ state: 'held', parallel: true });
  expect(await actions(svc)).toContain('parallel_escalate');
  expect((await svc.advanceClock('2026-07-07')).raised).toEqual([]); // 멱등
  await svc.decide(CONTRACT, 'ceo_board', 'approve'); // 1차 미결이어도 CEO가 먼저 결정
  const done = await svc.getCase(CONTRACT);
  expect(done.item.status).toBe('approved');
  expect(done.review!.state).toBe('closed_parallel');
  expect(await actions(svc)).toContain('primary_closed_parallel');
});

test('1st-stage return is a rejection that can be resubmitted and starts the 1st stage again', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryReturn(CONTRACT, 'masil_ceo', '테스트 사유');
  expect((await svc.getCase(CONTRACT)).item.status).toBe('rejected');
  await svc.resubmit(CONTRACT, 'marketing');
  expect((await svc.getCase(CONTRACT)).item.status).toBe('finance_review');
  await submitContract(svc);
  const d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('submitted');
  expect(d.review).toMatchObject({ state: 'pending', parallel: false });
  expect(await actions(svc)).toEqual(expect.arrayContaining(['primary_return', 'resubmit']));
});

test('answering the info request of a 1st-stage hold releases the hold', async () => {
  const { svc } = await make({ twoStage: true });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-10'));
  const req = (await svc.getCase(CONTRACT)).requests.find((q) => q.needed === 'payment_schedule')!;
  await svc.replyInfoRequest(req.id, { actor: 'ceo_board', text: '지급 일정 첨부', simulated: true, resolved: true });
  expect((await svc.getCase(CONTRACT)).review).toMatchObject({ state: 'pending', holdDue: null });
});

// ---------- 알림 계획표 ----------
test('current plan: nothing changes (retroactive D-14/7/3 and the D-3 escalation)', async () => {
  const { svc } = await make();
  const r = await svc.advanceClock('2026-07-14');
  expect(r.raised).toEqual(expect.arrayContaining([
    { caseId: CONTRACT, stage: 'D-14', kind: 'alert' }, { caseId: CONTRACT, stage: 'D-7', kind: 'alert' },
    { caseId: CONTRACT, stage: 'D-3', kind: 'alert' }, { caseId: CONTRACT, stage: 'D-3', kind: 'escalation' },
  ]));
});

test('extended plan does not create past stages retroactively and marks them as passed', async () => {
  const { svc, repo } = await make({ alertPlan: 'extended' }); // 기준일 7/1, 마감 7/17 → D-16
  expect(await repo.listAlerts(CONTRACT)).toEqual([]);
  const st = await svc.alertPlanStatus(CONTRACT);
  expect(st.map((s) => [s.stage, s.state])).toEqual([['D-30', 'passed'], ['D-14', 'scheduled'], ['D-7', 'scheduled'], ['D-3', 'scheduled']]);
  const r = await svc.advanceClock('2026-07-03');
  expect(r.raised).toContainEqual({ caseId: CONTRACT, stage: 'D-14', kind: 'alert' });
  expect(r.raised.some((x) => x.caseId === CONTRACT && x.stage === 'D-30')).toBe(false);
  expect((await svc.alertPlanStatus(CONTRACT)).find((s) => s.stage === 'D-14')!.state).toBe('sent');
});

test('extended plan: D-14 reaches the CEO of Masil as a not-ready warning, D-7 reaches the CEO/board; repeating is a no-op', async () => {
  const { svc, repo } = await make({ alertPlan: 'extended' });
  await svc.advanceClock('2026-07-03');
  const d14 = (await repo.listAlerts(CONTRACT)).find((a) => a.stage === 'D-14')!;
  const rec14 = (d14.payload as { recipients: { role: string; messageKey: string }[]; simulated: boolean });
  expect(rec14.simulated).toBe(true);
  expect(rec14.recipients.find((r) => r.role === 'masil_ceo')!.messageKey).toBe('not_ready_warning');
  await svc.advanceClock('2026-07-10');
  const d7 = (await repo.listAlerts(CONTRACT)).find((a) => a.stage === 'D-7')!;
  expect((d7.payload as { recipients: { role: string }[] }).recipients.map((r) => r.role)).toContain('ceo_board');
  expect((await svc.advanceClock('2026-07-10')).raised).toEqual([]);
});

test('extended plan on a case with 30+ days left: D-30, D-14, D-7 and D-3 audiences', async () => {
  const { svc, repo } = await make({ alertPlan: 'extended' });
  const id = 'PLAN-025'; // 실효 기한 2026-09-03, 대표 + 그룹 보고 경로
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing'); // 준비됨(결정 요청 가능)
  const who = async (stage: string) => {
    const a = (await repo.listAlerts(id)).find((x) => x.stage === stage)!;
    return (a.payload as { recipients: { role: string; messageKey: string }[] }).recipients;
  };
  await svc.advanceClock('2026-08-04');
  expect((await who('D-30')).map((r) => r.role).sort()).toEqual(['contract', 'finance', 'marketing']);
  await svc.advanceClock('2026-08-20');
  const d14 = await who('D-14');
  expect(d14.find((r) => r.role === 'masil_ceo')!.messageKey).toBe('decision_request');
  expect(d14.map((r) => r.role)).not.toContain('ceo_board');
  await svc.advanceClock('2026-08-27');
  expect((await who('D-7')).map((r) => r.role)).not.toContain('ceo_board');
  await svc.advanceClock('2026-08-31');
  expect((await who('D-3')).map((r) => r.role).sort()).toEqual(['contract', 'finance', 'marketing', 'masil_ceo']);
});

test('switching plans later never back-fills stages that already passed', async () => {
  const { svc, repo } = await make();
  await svc.advanceClock('2026-07-10'); // current: D-14, D-7 생성
  await svc.setConfig({ alertPlan: 'extended' });
  const st = await svc.alertPlanStatus(CONTRACT);
  expect(st.find((s) => s.stage === 'D-30')!.state).toBe('passed');
  await svc.advanceClock('2026-07-14');
  const stages = (await repo.listAlerts(CONTRACT)).map((a) => `${a.stage}:${a.kind}`);
  expect(stages).not.toContain('D-30:alert');
  expect(stages).toContain('D-3:alert');
});

test('extended plan warns at once when a 1st-stage hold passes its own due date', async () => {
  const { svc, repo } = await make({ twoStage: true, alertPlan: 'extended' });
  await submitContract(svc);
  await svc.primaryHold(CONTRACT, 'masil_ceo', hold('2026-07-08'));
  const r = await svc.advanceClock('2026-07-09');
  expect(r.raised).toContainEqual({ caseId: CONTRACT, stage: 'primary_hold_overdue', kind: 'warning' });
  const w = (await repo.listAlerts(CONTRACT)).find((a) => a.stage === 'primary_hold_overdue')!;
  expect((w.payload as { recipients: { role: string }[] }).recipients.map((x) => x.role).sort()).toEqual(['ceo_board', 'masil_ceo']);
});
