import { runScenario } from '../../src/app/demo.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function make() {
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  await svc.reset();
  return svc;
}

test('normal case: losses, early execution, routes, board date and link groups (spec 9)', async () => {
  const svc = await make();
  const { facts } = await runScenario(svc, 'normal');
  expect(facts.lossCampaigns).toEqual(['CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0012', 'CMP-0013', 'CMP-0014']);
  expect(facts.executionBeforeDeadline).toBe(12);
  expect(facts.ceoBoard).toBe(13);
  expect(facts.ceoBoardIncludesContract).toBe(true);
  expect(facts.boardDate).toBe('2026-07-06');
  expect(facts.masilGroupReport).toBe(13);
  expect(facts.hyeinGroup).toEqual(['CONTRACT-INF-001', 'PLAN-001', 'PLAN-002', 'PLAN-003']);
  expect(facts.avaGlowGroup).toEqual(['PLAN-005', 'PLAN-007', 'PLAN-009']);
});

test('change case: fee cut variants, replies and the LC-0001 45-day sensitivity (spec 9)', async () => {
  const svc = await make();
  const { facts } = await runScenario(svc, 'change');
  expect(facts.fee18).toMatchObject({ route: 'CEO_BOARD', penaltyAtRenewal: 900_000_000 });
  expect(facts.fee9).toMatchObject({ route: 'MASIL_CEO', infoRequest: true, simulated: true, deferredNote: true });
  expect(facts.reply0810Route).toBe('CEO_BOARD');
  expect(facts.reply0930Route).toBe('MASIL_CEO');
  expect(facts.lc45CeoBoard).toBe(1);
});

test('shortage case: hold, D-3 escalation, three replies, rejection and link warning (spec 9)', async () => {
  const svc = await make();
  const { facts } = await runScenario(svc, 'shortage');
  expect(facts.holdOwnerAndDue).toEqual({ ownerRole: 'finance', dueDate: '2026-07-08' });
  expect(facts.escalationOptions).toEqual(['change_terms_notice', 'termination_notice', 'submit_then_approve']);
  // 연 28억 원은 10억 원 초과라 어느 회신이든 CEO/이사회 상신이지만, 하회 구간 해당 여부 판정은 회신 날짜에 따라 갈린다.
  expect(facts.favorable).toEqual({ status: 'routed', route: 'CEO_BOARD', inBreach: '아니오' });
  expect(facts.unfavorable).toEqual({ status: 'routed', route: 'CEO_BOARD', inBreach: '예' });
  expect(facts.delayed).toEqual({ status: 'on_hold', requestStatus: 'requested' });
  expect(facts.afterRejectResubmit).toBe('submitted');
  expect(String(facts.linkWarning)).toContain('기안만 부결');
});

test('reset restores the initial state after a scenario ran', async () => {
  const svc = await make();
  await runScenario(svc, 'shortage');
  await svc.reset();
  const v = await svc.listToday();
  expect(v.today).toBe('2026-07-01');
  expect(v.items).toHaveLength(26);
  expect(v.items.every((i) => i.status === 'finance_review')).toBe(true);
  expect((await svc.getCase('PLAN-001')).events.map((e) => e.action)).toEqual(['received', 'calculated']);
  expect(v.scenario).toBe('baseline');
});

test('two-stage demo: blocked shortcuts, hold limit, urgent parallel request and parallel close (switch on)', async () => {
  const svc = await make();
  const { facts } = await runScenario(svc, 'twoStage');
  expect(facts.masilCannotApprove).toBe('ROLE_NOT_ALLOWED');
  expect(facts.ceoBeforeFirstStage).toBe('SECOND_STAGE_NOT_REQUESTED');
  expect(facts.holdBeyondCap).toBe('PRIMARY_HOLD_LIMIT');
  expect(facts.parallelBeforeUrgent).toBe(false);
  expect(facts.parallelAtUrgent).toBe(true);
  expect(facts.reviewAtUrgent).toEqual({ state: 'held', parallel: true });
  expect(facts.afterCeoDecision).toEqual({ status: 'approved', review: 'closed_parallel' });
});
