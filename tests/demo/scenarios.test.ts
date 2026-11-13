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

test('check demo: normal, changed assumptions and missing information', async () => {
  const svc = await make();
  const { facts, lines } = await runScenario(svc, 'check');
  expect(facts.normal).toMatchObject({ campaign: 'CMP-0005', inBreach: '아니오', route: 'MASIL_CEO_GROUP_REPORT', labelBefore: 'finance_pending', labelAfterFinance: 'ready', labelAfter: 'submitted' });
  expect(lines.join(' ')).toContain('기안 총액');
  const base = facts.changeBase as Record<string, { route: string; stillLoss: boolean }>;
  expect(base['PLAN-001'].route).toBe('CEO_BOARD');
  expect(base['CONTRACT-INF-001'].route).toBe('CEO_BOARD');
  expect(facts.changeKept).toMatchObject({ demandOnly: { route: 'CEO_BOARD', stillLoss: true }, arOverdueExcluded: { route: 'CEO_BOARD', breaches: ['2026-07-21~2026-08-28'] } });
  expect(facts.changeChanged).toMatchObject({ lc45: { route: 'MASIL_CEO_GROUP_REPORT', contractRoute: 'CEO_BOARD', breaches: [] } });
  const info = facts.infoMissing as Record<string, Record<string, string>>;
  expect(info.inside).toMatchObject({ asked: '확인 대기', inBreach: '예', route: 'CEO_BOARD', after: '상신 준비 완료' });
  expect(info.outside).toMatchObject({ inBreach: '아니오', route: 'CEO_BOARD', after: '상신 준비 완료' });
  expect(lines.join(' ')).toContain('어느 쪽이든 CEO/이사회');
});
