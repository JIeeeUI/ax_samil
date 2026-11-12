import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { canReturn, returnDueDate, backwardWindows } from '../../src/workflow/schedule.js';

const P = 'PLAN-001'; // 하회 구간 안(7/27), 손실, 배분 역전, 실효 기한 7/17
async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return svc;
}
const ret = (svc: IntakeService, over: Partial<Parameters<IntakeService['financeReturn']>[2]> = {}) =>
  svc.financeReturn(P, 'finance', { reasons: ['cash_breach', 'loss_or_inversion'], opinion: '현금 위험 구간과 손실이 겹칩니다', ...over });
const status = async (svc: IntakeService, id = P) => (await svc.getCase(id)).item.status;

test('schedule: reply due = min(return date + 3, effective deadline - 5); returns stop at 5 days or less', () => {
  expect(returnDueDate('2026-07-01', '2026-07-17')).toBe('2026-07-04');
  expect(returnDueDate('2026-07-10', '2026-07-17')).toBe('2026-07-12');
  expect(canReturn('2026-07-12', '2026-07-17')).toBe(false);
  expect(canReturn('2026-07-11', '2026-07-17')).toBe(true);
  expect(backwardWindows('2026-07-17')).toEqual({
    approver: { from: '2026-07-14', to: '2026-07-17' },
    financeRecheck: { from: '2026-07-12', to: '2026-07-14' },
    marketingBefore: '2026-07-12',
  });
});

test('the hints come from the engine result', async () => {
  const svc = await make();
  expect((await svc.getCase(P)).returnHints).toEqual(['cash_breach', 'loss_or_inversion']);
  expect((await svc.getCase('PLAN-004')).returnHints).toEqual([]);
});

test('only finance returns, with reasons and an opinion; the other kind needs text', async () => {
  const svc = await make();
  await expect(svc.financeReturn(P, 'marketing', { reasons: ['cash_breach'], opinion: 'x' })).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(ret(svc, { opinion: ' ' })).rejects.toThrow(/OPINION_REQUIRED/);
  await expect(ret(svc, { reasons: [] })).rejects.toThrow(/REASON_REQUIRED/);
  await expect(ret(svc, { reasons: ['other'] })).rejects.toThrow(/OTHER_TEXT_REQUIRED/);
  await expect(ret(svc, { reasons: ['bogus' as never] })).rejects.toThrow(/REASON_REQUIRED|INVALID/);
  expect(await status(svc)).toBe('finance_review');
  await ret(svc);
  const d = await svc.getCase(P);
  expect(d.item.status).toBe('revision');
  expect(d.revisions[0]).toMatchObject({ round: 1, status: 'open', dueDate: '2026-07-04', reasons: ['cash_breach', 'loss_or_inversion'] });
});

test('reasons can be switched off in the settings', async () => {
  const svc = await make();
  await svc.setConfig({ returnReasons: { weak_basis: false } });
  expect((await svc.getConfig()).returnReasons).toMatchObject({ weak_basis: false, cash_breach: true });
  await expect(ret(svc, { reasons: ['weak_basis'] })).rejects.toThrow(/REASON_REQUIRED|INVALID/);
  await expect(svc.setConfig({ returnReasons: { nope: true } as never })).rejects.toThrow(/INVALID_CONFIG/);
});

test('marketing adjusts the date: history is kept, the route is judged again, finance rechecks', async () => {
  const svc = await make();
  await ret(svc);
  await expect(svc.replyRevision(P, 'finance', { kind: 'adjust', text: 'x', settlementDate: '2026-08-28' })).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(svc.replyRevision(P, 'marketing', { kind: 'adjust', text: 'x' })).rejects.toThrow(/INVALID_ADJUSTMENT/);
  expect((await svc.getCase(P)).item.routeLevel).toBe('CEO_BOARD');
  await svc.replyRevision(P, 'marketing', { kind: 'adjust', text: '집행일을 뒤로 미룹니다', settlementDate: '2026-08-28' });
  const d = await svc.getCase(P);
  expect(d.item.status).toBe('finance_review');
  expect(d.item.routeLevel).toBe('MASIL_CEO_GROUP_REPORT');
  expect(d.item.settlementDate).toBe('2026-08-28');
  expect(d.adjustments).toEqual([expect.objectContaining({ field: 'settlementDate', from: '2026-07-27', to: '2026-08-28' })]);
  expect(d.revisions[0].status).toBe('adjusted');
});

test('second time there is no return: finance attaches an opinion and submits', async () => {
  const svc = await make();
  await ret(svc);
  await svc.replyRevision(P, 'marketing', { kind: 'adjust', text: '요청액을 줄입니다', amount: 10_000_000 });
  await expect(ret(svc)).rejects.toThrow(/ROUND_LIMIT/);
  await svc.confirmFinance(P, 'finance', { opinion: '손실 캠페인이라 주의' });
  expect(await status(svc)).toBe('routed');
  await svc.submit(P, 'finance');
  expect(await status(svc)).toBe('submitted');
  expect((await svc.getCase(P)).events.some((e) => e.action === 'confirm_finance' && JSON.stringify(e.detail).includes('손실 캠페인이라 주의'))).toBe(true);
});

test('no return when 5 days or less remain', async () => {
  const svc = await make();
  await svc.advanceClock('2026-07-12');
  await expect(ret(svc)).rejects.toThrow(/RETURN_NOT_ALLOWED/);
});

test('marketing keeps it unchanged: the opinion stays and finance submits', async () => {
  const svc = await make();
  await ret(svc);
  await svc.replyRevision(P, 'marketing', { kind: 'keep', text: '변경 없이 진행' });
  expect(await status(svc)).toBe('routed');
  expect((await svc.getCase(P)).revisions[0]).toMatchObject({ status: 'kept' });
  await svc.submit(P, 'finance');
  expect(await status(svc)).toBe('submitted');
});

test('marketing asks for a consultation: recorded and the case waits', async () => {
  const svc = await make();
  await ret(svc);
  await svc.replyRevision(P, 'marketing', { kind: 'consult', text: '재무와 협의가 필요합니다' });
  expect(await status(svc)).toBe('consulting');
  expect((await svc.getCase(P)).revisions[0].status).toBe('consult');
});

test('no reply by the due date: marked unanswered and forwarded to the approver with the finance opinion', async () => {
  const svc = await make();
  await ret(svc);
  await svc.advanceClock('2026-07-04');
  expect(await status(svc)).toBe('revision');
  await svc.advanceClock('2026-07-05');
  const d = await svc.getCase(P);
  expect(d.item.status).toBe('submitted');
  expect(d.revisions[0].status).toBe('unanswered');
  const ev = d.events.find((e) => e.action === 'revision_unanswered')!;
  expect(ev.actor_role).toBe('system');
  expect(JSON.stringify(ev.detail)).toContain('현금 위험 구간');
});

test('after the effective deadline the case expires as before', async () => {
  const svc = await make();
  await ret(svc);
  await svc.advanceClock('2026-07-18');
  expect(await status(svc)).toBe('overdue');
});
