import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { IntakeService } from '../../src/app/service.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const room = loadDataRoom();
const CONTRACT = 'CONTRACT-INF-001';

async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room });
  await svc.reset();
  return { svc, repo };
}

const byLevel = async (svc: IntakeService, level: string) =>
  (await svc.listToday()).items.filter((i) => i.routeLevel === level);

/** 계약을 재무 확인·상신까지 올린다. */
async function submitContract(svc: IntakeService) {
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
}

test('reset seeds 26 cases in finance_review with received/calculated events and current-stage alerts', async () => {
  const { svc, repo } = await make();
  const v = await svc.listToday();
  expect(v.items).toHaveLength(26);
  expect(v.items.every((i) => i.status === 'finance_review')).toBe(true);
  expect(v.today).toBe('2026-07-01');
  const ev = await repo.listEvents('PLAN-001');
  expect(ev.map((e) => e.action)).toEqual(['received', 'calculated']);
  expect(ev[1].snapshot).toMatchObject({ scenario: 'baseline' });
  // 기준일 2026-07-01에는 실효 기한이 14일 이내인 건만 D-14 알림을 갖는다(데이터에 따라 0건일 수 있다).
  const due = v.items.filter((i) => i.daysLeft <= 14 && i.daysLeft >= 0).length;
  expect((await repo.listAlerts()).filter((a) => a.stage === 'D-14' && a.kind === 'alert')).toHaveLength(due);
});

test('baseline routing: 13 CEO_BOARD (12 plans + contract) and 13 MASIL_CEO_GROUP_REPORT', async () => {
  const { svc } = await make();
  const ceo = await byLevel(svc, 'CEO_BOARD');
  expect(ceo).toHaveLength(13);
  expect(ceo.map((i) => i.id)).toContain(CONTRACT);
  expect(ceo.every((i) => i.boardDate === '2026-07-06')).toBe(true);
  expect(await byLevel(svc, 'MASIL_CEO_GROUP_REPORT')).toHaveLength(13);
});

test('full happy path to approved', async () => {
  const { svc } = await make();
  const id = (await byLevel(svc, 'MASIL_CEO_GROUP_REPORT'))[0].id;
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  await svc.decide(id, 'masil_ceo', 'approve');
  const d = await svc.getCase(id);
  expect(d.item.status).toBe('approved');
  expect(d.events.map((e) => e.action)).toEqual(['received', 'calculated', 'confirm_finance', 'submit', 'approve']);
});

test('deciding twice is rejected and leaves one decision event', async () => {
  const { svc } = await make();
  const id = (await byLevel(svc, 'MASIL_CEO_GROUP_REPORT'))[0].id;
  await svc.confirmFinance(id, 'finance');
  await svc.submit(id, 'marketing');
  await svc.decide(id, 'masil_ceo', 'approve');
  await expect(svc.decide(id, 'masil_ceo', 'approve')).rejects.toThrow(/INVALID_TRANSITION/);
  expect((await svc.getCase(id)).events.filter((e) => e.action === 'approve')).toHaveLength(1);
});

test('hold without owner/due is rejected; a valid hold creates an info request', async () => {
  const { svc } = await make();
  await submitContract(svc);
  await expect(svc.decide(CONTRACT, 'ceo_board', { hold: { needed: 'x', ownerRole: 'finance', dueDate: '' } }))
    .rejects.toThrow(/HOLD_REQUIRES/);
  expect((await svc.getCase(CONTRACT)).item.status).toBe('submitted');
  await svc.decide(CONTRACT, 'ceo_board', { hold: { needed: 'payment_schedule', ownerRole: 'finance', dueDate: '2026-07-04' } });
  const d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('on_hold');
  expect(d.requests.find((r) => r.needed === 'payment_schedule')).toMatchObject({ ownerRole: 'finance', dueDate: '2026-07-04', status: 'requested' });
});

test('advanceClock raises a D-3 escalation with three options; going back or repeating is safe', async () => {
  const { svc, repo } = await make();
  const r = await svc.advanceClock('2026-07-14');
  expect(r.raised).toContainEqual({ caseId: CONTRACT, stage: 'D-3', kind: 'escalation' });
  const esc = (await repo.listAlerts(CONTRACT)).find((a) => a.kind === 'escalation')!;
  expect((esc.payload as { options: string[] }).options).toHaveLength(3);
  await expect(svc.advanceClock('2026-07-10')).rejects.toThrow(/CLOCK_BACKWARDS/);
  const again = await svc.advanceClock('2026-07-14');
  expect(again.raised).toEqual([]);
  expect((await repo.listAlerts(CONTRACT)).filter((a) => a.stage === 'D-3')).toHaveLength(2); // alert + escalation, once each
});

test('advanceClock past the deadline expires the undecided contract into overdue', async () => {
  const { svc } = await make();
  await svc.advanceClock('2026-07-18');
  const d = await svc.getCase(CONTRACT);
  expect(d.item.status).toBe('overdue');
  const ev = d.events.find((e) => e.action === 'expire')!;
  expect(ev.actor_role).toBe('system');
  await expect(svc.decide(CONTRACT, 'ceo_board', 'approve')).rejects.toThrow(/INVALID_TRANSITION/);
});

test('reply with an invalid date or amount is rejected and the request stays requested', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ annualFixedFeeKrw: 900_000_000 });
  const req = (await svc.getCase(CONTRACT)).requests[0];
  await expect(svc.replyInfoRequest(req.id, { actor: 'ceo_board', text: 'x', values: { cashOutflowDate: '2026-13-45' }, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  await expect(svc.replyInfoRequest(req.id, { actor: 'ceo_board', text: 'x', values: { annualFixedFeeKrw: -5 }, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  expect((await svc.getCase(CONTRACT)).requests[0].status).toBe('requested');
});

test('contract change: 1.8bn stays CEO_BOARD; 0.9bn becomes MASIL_CEO with a cash_outflow_date request', async () => {
  const a = await make();
  await a.svc.proposeContractChange({ annualFixedFeeKrw: 1_800_000_000 });
  expect((await a.svc.getCase(CONTRACT)).item.routeLevel).toBe('CEO_BOARD');
  const b = await make();
  await b.svc.proposeContractChange({ annualFixedFeeKrw: 900_000_000 });
  const d = await b.svc.getCase(CONTRACT);
  expect(d.item.routeLevel).toBe('MASIL_CEO');
  expect(d.requests.find((r) => r.needed === 'cash_outflow_date')).toMatchObject({ ownerRole: 'finance', status: 'requested', simulated: true });
  expect(d.events.find((e) => e.action === 'propose_change')!.simulated).toBe(true);
});

test('reply cashOutflowDate inside the breach -> CEO_BOARD, outside -> MASIL_CEO; text-only reply keeps the hold', async () => {
  const inside = await make();
  await inside.svc.proposeContractChange({ annualFixedFeeKrw: 900_000_000 });
  const r1 = (await inside.svc.getCase(CONTRACT)).requests[0];
  await inside.svc.replyInfoRequest(r1.id, { actor: 'ceo_board', text: '8/10 지급', values: { cashOutflowDate: '2026-08-10' }, simulated: true });
  expect((await inside.svc.getCase(CONTRACT)).item.routeLevel).toBe('CEO_BOARD');

  const outside = await make();
  await outside.svc.proposeContractChange({ annualFixedFeeKrw: 900_000_000 });
  const r2 = (await outside.svc.getCase(CONTRACT)).requests[0];
  await outside.svc.replyInfoRequest(r2.id, { actor: 'ceo_board', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect((await outside.svc.getCase(CONTRACT)).item.routeLevel).toBe('MASIL_CEO');

  const delayed = await make();
  await submitContract(delayed.svc);
  await delayed.svc.decide(CONTRACT, 'ceo_board', { hold: { needed: 'cash_outflow_date', ownerRole: 'finance', dueDate: '2026-07-04' } });
  const r3 = (await delayed.svc.getCase(CONTRACT)).requests.find((r) => r.needed === 'cash_outflow_date' && r.status === 'requested')!;
  await delayed.svc.replyInfoRequest(r3.id, { actor: 'ceo_board', text: '아직 미정', simulated: true });
  const d = await delayed.svc.getCase(CONTRACT);
  expect(d.item.status).toBe('on_hold');
  expect(d.requests.find((r) => r.id === r3.id)!.status).toBe('requested');
});

test('setScenario re-routes only non-terminal cases and logs the reason; closed cases are untouched', async () => {
  const { svc } = await make();
  const [closedId, openId] = (await byLevel(svc, 'CEO_BOARD')).filter((i) => i.kind === 'plan').map((i) => i.id);
  await svc.confirmFinance(closedId, 'finance');
  await svc.submit(closedId, 'marketing');
  await svc.decide(closedId, 'ceo_board', 'reject');
  await svc.close(closedId, 'marketing');
  await svc.setScenario('lc45');
  const open = await svc.getCase(openId);
  expect(open.item.routeLevel).toBe('MASIL_CEO_GROUP_REPORT');
  expect(open.events.find((e) => e.action === 'scenario_change')!.detail).toMatchObject({ from: 'baseline', to: 'lc45' });
  const closed = await svc.getCase(closedId);
  expect(closed.item.routeLevel).toBe('CEO_BOARD');
  expect(closed.events.some((e) => e.action === 'scenario_change')).toBe(false);
});

test('contract detail carries the deferred-judgement note and penalty', async () => {
  const { svc } = await make();
  const d = await svc.getCase(CONTRACT);
  expect(d.notes.join(' ')).toContain('금액 판단 유보');
  expect(d.penalty).toBe(1_400_000_000);
  expect((await svc.getCase('PLAN-001')).penalty).toBeNull();
});
