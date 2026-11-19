// 외부 검토(2026-11-19)의 중요 지적에 대한 회귀 테스트: C1 보류 상한, N1/N2/C2 통보 반영.
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

describe('C1: a hold may not be due after the decision deadline', () => {
  test('due the day after the effective deadline is refused and changes nothing', async () => {
    const svc = await make();
    await toSubmitted(svc);
    await expect(svc.decide(C, 'ceo_board', { hold: { needed: '고정 피 지급일', ownerRole: 'finance', dueDate: '2026-07-18' } }))
      .rejects.toThrow(/HOLD_AFTER_DEADLINE/);
    const d = await svc.getCase(C);
    expect(d.item.status).toBe('submitted');
    expect(d.requests.filter((q) => q.needed === '고정 피 지급일')).toHaveLength(0);
  });

  test('due on the deadline day itself is allowed', async () => {
    const svc = await make();
    await toSubmitted(svc);
    await svc.decide(C, 'ceo_board', { hold: { needed: '고정 피 지급일', ownerRole: 'finance', dueDate: '2026-07-17' } });
    expect((await svc.getCase(C)).item.status).toBe('on_hold');
  });

  test('a plan is capped by its own effective deadline (settlement date before contract deadline)', async () => {
    const svc = await make();
    // PLAN-021: 집행 7/21, 확정기한 9/11 → 실효 결정 기한 7/21
    await svc.confirmFinance('PLAN-021', 'finance');
    await svc.submit('PLAN-021', 'marketing');
    await expect(svc.decide('PLAN-021', 'ceo_board', { hold: { needed: '추가 자료', ownerRole: 'finance', dueDate: '2026-07-22' } }))
      .rejects.toThrow(/HOLD_AFTER_DEADLINE/);
    await svc.decide('PLAN-021', 'ceo_board', { hold: { needed: '추가 자료', ownerRole: 'finance', dueDate: '2026-07-21' } });
    expect((await svc.getCase('PLAN-021')).item.status).toBe('on_hold');
  });
});

const sendAndRecord = async (svc: IntakeService, receiptProof: boolean) => {
  await svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' });
  await svc.recordNotice(C, 'contract', { receiptProof });
};
const rejectContract = async (svc: IntakeService) => {
  await toSubmitted(svc);
  await svc.decide(C, 'ceo_board', { reject: { reason: '갱신하지 않음' } });
};
const approveChangedContract = async (svc: IntakeService) => {
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  let d = await svc.getCase(C);
  const perf = d.requests.find((q) => q.needed === 'performance_fee_terms' && q.status === 'requested')!;
  await svc.replyInfoRequest(perf.id, { actor: 'contract', text: '성과 피 별도 없음', resolved: true, simulated: true });
  await svc.confirmFinance(C, 'finance');
  d = await svc.getCase(C);
  const cash = d.requests.find((q) => q.needed === 'cash_outflow_date' && q.status === 'requested')!;
  await svc.replyInfoRequest(cash.id, { actor: 'finance', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  await svc.submit(C, 'marketing');
  await svc.decide(C, 'masil_ceo', 'approve');
};

describe('N1: a termination notice sent in time prevents the automatic confirmation', () => {
  test.each([true, false])('sent 7/1, recorded (receipt proof %s) → still not overdue on 7/18', async (proof) => {
    const svc = await make();
    await rejectContract(svc);
    await sendAndRecord(svc, proof);
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.item.status).toBe('rejected');
    expect(d.events.filter((e) => e.action === 'expire')).toHaveLength(0);
  });

  test('no notice sent → the contract still expires into automatic renewal', async () => {
    const svc = await make();
    await rejectContract(svc);
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.item.status).toBe('overdue');
    expect(d.events.filter((e) => e.action === 'expire')).toHaveLength(1);
  });
});

describe('N2: a required notice that missed its deadline is never hidden', () => {
  test('approved with a change notice left open → warning and one alert after the due date', async () => {
    const svc = await make();
    await approveChangedContract(svc);
    expect((await svc.getCase(C)).notice).toMatchObject({ kind: 'change', required: true, status: 'open' });
    await svc.advanceClock('2026-07-18');
    let d = await svc.getCase(C);
    expect(d.item.status).toBe('approved');
    expect(d.noticeWarning).toMatch(/변경 통보를 2026-07-17까지 보내지 않았습니다/);
    expect(d.noticeWarningMissed).toBe(true);
    expect(d.alerts.filter((a) => a.kind === 'notice_missed')).toHaveLength(1);
    await svc.advanceClock('2026-07-19'); // 다시 돌려도 중복 알림은 없다
    d = await svc.getCase(C);
    expect(d.alerts.filter((a) => a.kind === 'notice_missed')).toHaveLength(1);
  });

  test('a notice that was sent in time raises no warning', async () => {
    const svc = await make();
    await approveChangedContract(svc);
    await svc.sendNotice(C, 'marketing', { kind: 'change', sentDate: '2026-07-01' });
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.noticeWarning).toBeNull();
    expect(d.alerts.filter((a) => a.kind === 'notice_missed')).toHaveLength(0);
  });

  test('closing a rejected contract is refused while the required termination notice is unsent', async () => {
    const svc = await make();
    await rejectContract(svc);
    await expect(svc.close(C, 'marketing')).rejects.toThrow(/NOTICE_REQUIRED_OPEN/);
    expect((await svc.getCase(C)).item.status).toBe('rejected');
    await svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' });
    await svc.close(C, 'marketing');
    expect((await svc.getCase(C)).item.status).toBe('closed');
  });
});

describe('C2: after an automatic confirmation the contract says what happened', () => {
  test('overdue contract states the renewal result and no stale countdown remains', async () => {
    const svc = await make();
    await svc.advanceClock('2026-07-14');
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.item.status).toBe('overdue');
    expect(d.autoRenewResult).toMatch(/자동 갱신/);
    expect(d.autoRenewResult).toMatch(/위약금/);
    expect(d.autoRenewResult).toMatch(/140,000만 원/);
    expect(d.escalation).toBeNull();
    expect(JSON.stringify(d.check)).not.toMatch(/남은 -\d+일|기한이 코앞/);
  });

  test('other cases have no renewal result', async () => {
    const svc = await make();
    await svc.advanceClock('2026-07-18');
    expect((await svc.getCase('PLAN-001')).autoRenewResult).toBeNull();
  });
});

describe('C2 (summary): the approver summary never prints a negative countdown', () => {
  test('before the deadline it keeps the countdown; after it says how many days have passed', async () => {
    const { summarizeForApproval, buildFacts } = await import('../../src/ai/assist.js');
    const svc = await make();
    const before = await summarizeForApproval(await svc.getCase(C), null);
    expect(before.text).toMatch(/남은 16일/);
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    const after = await summarizeForApproval(d, null);
    expect(after.text).not.toMatch(/남은 -\d+일/);
    expect(after.text).toMatch(/1일 지남/);
    expect(JSON.stringify(buildFacts(d))).not.toMatch(/남은 -\d+일/);
  });
});

describe('N2 (history): the missed-notice record is readable and addressed', () => {
  test('history entry for notice_missed goes to marketing and has a Korean label', async () => {
    const svc = await make();
    await approveChangedContract(svc);
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    const entry = d.history.find((h) => h.action === 'notice_missed');
    expect(entry).toBeDefined();
    expect(entry!.to?.role).toBe('marketing');
    const { ACTION_LABEL } = await import('../../app/components.js');
    expect(ACTION_LABEL['notice_missed']).toBe('필수 통보 기한 경과');
  });
});

describe('C2 (accuracy): the renewal result states the terms that actually renew', () => {
  test('a proposed-but-unapproved fee change does not replace the original terms in the renewal result', async () => {
    const svc = await make();
    await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.item.status).toBe('overdue');
    // 통보서의 현재 조건은 연 28억 원이다. 제안만 하고 승인하지 않았으므로 갱신 조건은 바뀌지 않는다.
    expect(d.autoRenewResult).toMatch(/280,000만 원/);
    expect(d.autoRenewResult).toMatch(/140,000만 원/);
    // 제안했던 금액은 '적용되지 않는 조건'으로만 언급된다(갱신 금액으로 읽히면 안 된다).
    expect(d.autoRenewResult).toMatch(/제안했던 연 90,000만 원은 승인되지 않아 적용되지 않습니다/);
    expect(d.autoRenewResult).not.toMatch(/연 90,000만 원의 고정 피/);
  });
});

describe('N2 (structure): the missed/pending distinction is a field, not a text prefix', () => {
  test('noticeWarningMissed is false for the pre-deadline warning and true only after a missed required notice', async () => {
    const svc = await make();
    await svc.advanceClock('2026-07-14');
    let d = await svc.getCase(C);
    expect(d.noticeWarning).toMatch(/자동 갱신/);
    expect(d.noticeWarningMissed).toBe(false); // 아직 기한 전: "통보 미완료 시 자동 갱신" 경고
    const approved = await make();
    await approveChangedContract(approved);
    await approved.advanceClock('2026-07-18');
    d = await approved.getCase(C);
    expect(d.noticeWarning).toMatch(/변경 통보/);
    expect(d.noticeWarningMissed).toBe(true);
    const none = await make();
    expect((await none.getCase(C)).noticeWarningMissed).toBe(false);
  });
});

describe('N2 (late): a notice sent after its due date is shown as late, not as fulfilled', () => {
  test('sent on 7/18 for a 7/17 due date keeps a "late" warning and is not treated as in time', async () => {
    const svc = await make();
    await approveChangedContract(svc);
    await svc.advanceClock('2026-07-18');
    await svc.sendNotice(C, 'marketing', { kind: 'change', sentDate: '2026-07-18' });
    const d = await svc.getCase(C);
    expect(d.notice).toMatchObject({ status: 'sent', sentDate: '2026-07-18', dueDate: '2026-07-17' });
    expect(d.noticeWarningMissed).toBe(true);
    expect(d.noticeWarning).toMatch(/변경 통보를 2026-07-18에 보냈지만 마감 2026-07-17이 지났습니다/);
  });

  test('sent in time keeps no warning (regression guard for the late rule)', async () => {
    const svc = await make();
    await approveChangedContract(svc);
    await svc.sendNotice(C, 'marketing', { kind: 'change', sentDate: '2026-07-01' });
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.noticeWarning).toBeNull();
    expect(d.noticeWarningMissed).toBe(false);
  });
});

describe('N1 (primary return): the first-stage return creates the same termination notice and the same rule applies', () => {
  test('a primary return followed by an in-time termination notice does not expire into renewal', async () => {
    const svc = await make();
    await svc.setConfig({ twoStage: true });
    await toSubmitted(svc);
    await svc.primaryReturn(C, 'masil_ceo', '1차에서 반려');
    expect((await svc.getCase(C)).notice).toMatchObject({ kind: 'terminate', required: true, status: 'open' });
    await svc.sendNotice(C, 'marketing', { kind: 'terminate', sentDate: '2026-07-01' });
    await svc.advanceClock('2026-07-18');
    const d = await svc.getCase(C);
    expect(d.item.status).not.toBe('overdue');
    expect(d.events.filter((e) => e.action === 'expire')).toHaveLength(0);
  });
});
