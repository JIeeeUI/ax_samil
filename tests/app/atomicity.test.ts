import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb, type Db } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const C = 'CONTRACT-INF-001';
const WRITE = /^\s*(insert|update|delete|truncate)\b/i;
const TABLES = ['clock', 'settings', 'case_state', 'events', 'info_requests', 'review1', 'revisions', 'notices', 'alerts'];

/** n번째 쓰기 문장에서 실패시키는 Db 감싸개(트랜잭션 안의 문장도 센다). */
function faulty(base: Db, ctl: { writes: number; failAt: number }): Db {
  const wrap = (db: Db): Db => ({
    async query<T>(sql: string, params?: unknown[]) {
      if (WRITE.test(sql) && ++ctl.writes === ctl.failAt) throw new Error(`INJECTED_FAILURE at write #${ctl.failAt}`);
      return db.query<T>(sql, params);
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(base);
}

/** 전체 저장 내용(실제 기록 시각은 제외) */
async function dump(db: Db): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = await db.query<Record<string, unknown>>(`select * from ${t}`);
    out[t] = rows.map((r) => { const { real_time: _t, ...rest } = r; return rest; }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return JSON.stringify(out);
}

async function make() {
  const base = await openDb({});
  const ctl = { writes: 0, failAt: 0 };
  const repo = new Repo(faulty(base, ctl));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return { svc, base, ctl };
}

/** 쓰기 단계마다 하나씩 실패시켜 보고, 실패한 시도는 아무것도 바꾸지 않았는지, 마지막에 재시도가 성공하는지 확인한다. */
async function everyStepRollsBack(run: (s: IntakeService) => Promise<unknown>, prepare: (s: IntakeService) => Promise<void> = async () => {}, only?: number[]) {
  const { svc, base, ctl } = await make();
  await prepare(svc);
  const before = await dump(base);
  ctl.writes = 0; ctl.failAt = 0;
  await run(svc); // 정상 실행으로 쓰기 횟수를 센다
  const total = ctl.writes;
  expect(total).toBeGreaterThan(1);
  expect(await dump(base)).not.toBe(before);
  const { svc: s2, base: b2, ctl: c2 } = await make(); // 같은 준비로 다시 만든다(정상 실행이 상태를 바꿨으므로)
  await prepare(s2);
  const snap = await dump(b2);
  for (let k = 1; k <= total; k++) {
    if (only && !only.includes(k)) continue;
    c2.writes = 0; c2.failAt = k;
    await expect(run(s2)).rejects.toThrow(/INJECTED_FAILURE/);
    expect(await dump(b2), `쓰기 #${k}/${total}에서 실패한 뒤 저장 내용이 달라짐`).toBe(snap);
  }
  c2.failAt = 0;
  await run(s2); // 재시도 성공
  expect(await dump(b2)).not.toBe(snap);
  return total;
}

test('R2: confirm_finance — a failure at any write leaves state, events and requests as they were; the retry works', async () => {
  const total = await everyStepRollsBack((s) => s.confirmFinance('PLAN-001', 'finance'));
  expect(total).toBeGreaterThanOrEqual(2); // 상태 전이 + 이력
});

test('R2: confirm_finance on the contract also rolls back the info requests it creates', async () => {
  await everyStepRollsBack((s) => s.confirmFinance(C, 'finance'));
});

test('R2: submit, decide (hold), reply and resubmit paths roll back as a unit', async () => {
  await everyStepRollsBack((s) => s.submit('PLAN-004', 'marketing'), async (s) => { await s.confirmFinance('PLAN-004', 'finance'); });
  await everyStepRollsBack(
    (s) => s.decide(C, 'ceo_board', { hold: { needed: 'payment_schedule', ownerRole: 'finance', dueDate: '2026-07-08' } }),
    async (s) => { await s.confirmFinance(C, 'finance'); await s.submit(C, 'marketing'); });
  await everyStepRollsBack(
    async (s) => {
      const q = (await s.getCase(C)).requests.find((r) => r.status === 'requested')!;
      await s.replyInfoRequest(q.id, { actor: 'finance', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
    },
    async (s) => { await s.confirmFinance(C, 'finance'); });
  await everyStepRollsBack(
    (s) => s.resubmit('PLAN-004', 'marketing'),
    async (s) => { await s.confirmFinance('PLAN-004', 'finance'); await s.submit('PLAN-004', 'marketing'); await s.decide('PLAN-004', 'masil_ceo', { reject: { reason: '재검토' } }); });
}, 180_000);

test('R2: finance return, marketing adjustment, notice, clock, config and contract-change paths roll back as a unit', async () => {
  await everyStepRollsBack((s) => s.financeReturn('PLAN-001', 'finance', { reasons: ['cash_breach'], opinion: '현금 위험' }));
  await everyStepRollsBack(
    (s) => s.replyRevision('PLAN-001', 'marketing', { kind: 'adjust', text: '조정', settlementDate: '2026-08-28' }),
    async (s) => { await s.financeReturn('PLAN-001', 'finance', { reasons: ['cash_breach'], opinion: '현금 위험' }); });
  await everyStepRollsBack(
    (s) => s.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' }),
    async (s) => { await s.confirmFinance(C, 'finance'); await s.submit(C, 'marketing'); await s.decide(C, 'ceo_board', { reject: { reason: '갱신 안 함' } }); });
  await everyStepRollsBack((s) => s.advanceClock('2026-07-14'), undefined, [1, 2, 3, 5, 8]);
  await everyStepRollsBack((s) => s.setConfig({ alertPlan: 'extended', twoStage: true }));
  await everyStepRollsBack((s) => s.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 }));
}, 180_000);

test('R2: a full reset that fails part-way restores everything', async () => {
  await everyStepRollsBack((s) => s.reset(), async (s) => { await s.confirmFinance('PLAN-001', 'finance'); }, [1, 2, 10, 40, 80]);
});

test('R2: the same case handled twice at the same time succeeds once and leaves one history entry', async () => {
  const { svc } = await make();
  const results = await Promise.allSettled([svc.confirmFinance('PLAN-001', 'finance'), svc.confirmFinance('PLAN-001', 'finance')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const d = await svc.getCase('PLAN-001');
  expect(d.events.filter((e) => e.action === 'confirm_finance')).toHaveLength(1);
  expect(d.item.status).toBe('routed');
  const dupSubmit = await Promise.allSettled([svc.submit('PLAN-001', 'marketing'), svc.submit('PLAN-001', 'finance')]);
  expect(dupSubmit.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await svc.getCase('PLAN-001')).events.filter((e) => e.action === 'submit')).toHaveLength(1);
});

test('R2: two simultaneous contract confirmations create the info requests once', async () => {
  const { svc } = await make();
  await Promise.allSettled([svc.confirmFinance(C, 'finance'), svc.confirmFinance(C, 'finance')]);
  const reqs = (await svc.getCase(C)).requests.filter((q) => q.needed === 'cash_outflow_date');
  expect(reqs).toHaveLength(1);
});

test('every state-changing public method is in the atomic list; reads are not wrapped', async () => {
  const { ATOMIC_METHODS } = await import('../../src/app/service.js');
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  for (const name of ATOMIC_METHODS) expect(typeof (svc as unknown as Record<string, unknown>)[name]).toBe('function');
  // 읽기 전용 메서드와 내부 도우미를 뺀 나머지 공개 메서드가 모두 목록에 있어야 새 변경 메서드가 빠지지 않는다
  const reads = new Set(['constructor', 'ensureInitialized', 'getScenario', 'getClock', 'listToday', 'getCase', 'getConfig', 'alertPlanStatus']);
  const proto = Object.getOwnPropertyNames(IntakeService.prototype);
  const publicMethods = proto.filter((n) => !reads.has(n) && !['compute', 'snapshot', 'log', 'requireState', 'ensureInfoRequests', 'runGuard', 'guardMissedNotice', 'noticeWarnings', 'runPlan', 'runReviewGuard', 'forwardUnanswered', 'buildItems', 'ownerMap', 'reviewMap', 'statusMap', 'hints', 'returnState', 'lastRejection', 'checkResult', 'closeOpenRequests', 'act', 'decideCore', 'createNotice', 'voidNotice', 'applyContract', 'rejudge', 'isReady', 'reviewOrDefault', 'reviewView', 'primaryContext', 'sweepReview', 'releasePrimaryHold', 'adjustedRoom', 'atomic', 'repo'].includes(n));
  expect(publicMethods.filter((n) => !(ATOMIC_METHODS as readonly string[]).includes(n))).toEqual([]);
});
