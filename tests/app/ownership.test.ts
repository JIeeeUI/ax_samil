import { nextStep } from '../../app/plain.js';
import { decisionFromForm } from '../../src/app/commands.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { canReply, defaultOwnerFor } from '../../src/workflow/ownership.js';

const CONTRACT = 'CONTRACT-INF-001';
async function make(cfg: Parameters<IntakeService['setConfig']>[0] = {}) {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  if (Object.keys(cfg).length) await svc.setConfig(cfg);
  return { svc, repo };
}
const reqOf = async (svc: IntakeService, needed: string) => (await svc.getCase(CONTRACT)).requests.find((q) => q.needed === needed)!;

test('owner follows the department that holds the information', () => {
  expect(defaultOwnerFor('cash_outflow_date')).toBe('finance');
  expect(defaultOwnerFor('payment_schedule')).toBe('finance');
  expect(defaultOwnerFor('performance_fee_terms')).toBe('contract');
  expect(defaultOwnerFor('contract_text')).toBe('contract');
  expect(defaultOwnerFor('notice_receipt_proof')).toBe('contract');
  expect(defaultOwnerFor('expected_gmv_basis')).toBe('marketing');
  expect(defaultOwnerFor('something_else')).toBe('finance');
  expect(defaultOwnerFor('toString')).toBe('finance');
});

test('only the owner and the deciding roles may answer', () => {
  expect(canReply('contract', 'contract')).toBe(true);
  expect(canReply('masil_ceo', 'contract')).toBe(true);
  expect(canReply('ceo_board', 'finance')).toBe(true);
  expect(canReply('marketing', 'contract')).toBe(false);
  expect(canReply('finance', 'contract')).toBe(false);
  expect(canReply('system', 'finance')).toBe(false);
});

test('the 9억 variant asks finance for the payment date and the contract owner for the performance-fee terms', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  expect(await reqOf(svc, 'cash_outflow_date')).toMatchObject({ ownerRole: 'finance', status: 'requested' });
  expect(await reqOf(svc, 'performance_fee_terms')).toMatchObject({ ownerRole: 'contract', status: 'requested' });
});

test('a role that is neither the owner nor a deciding role cannot answer; the owner and the approvers can', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  const perf = await reqOf(svc, 'performance_fee_terms');
  const ask = (actor: 'marketing' | 'finance' | 'contract' | 'masil_ceo' | 'ceo_board') =>
    svc.replyInfoRequest(perf.id, { actor, text: '성과 피 별도 정산, 10억 이하', simulated: true, resolved: true });
  await expect(ask('marketing')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(ask('finance')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  expect((await reqOf(svc, 'performance_fee_terms')).status).toBe('requested'); // 거부되면 요청은 그대로
  await ask('contract');
  expect((await reqOf(svc, 'performance_fee_terms')).status).toBe('replied');
  // 결재자는 담당 대신 입력할 수 있다
  const cash = await reqOf(svc, 'cash_outflow_date');
  await svc.replyInfoRequest(cash.id, { actor: 'ceo_board', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect((await reqOf(svc, 'cash_outflow_date')).status).toBe('replied');
});

test('the CEO of Masil can answer on behalf of the owner', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  const perf = await reqOf(svc, 'performance_fee_terms');
  await svc.replyInfoRequest(perf.id, { actor: 'masil_ceo', text: '대신 입력', simulated: true, resolved: true });
  expect((await reqOf(svc, 'performance_fee_terms')).status).toBe('replied');
});

test('after a rejection only marketing may resubmit or close; finance is refused', async () => {
  const { svc } = await make();
  const plan = (await svc.listToday()).items.find((i) => i.kind === 'plan' && i.routeLevel === 'MASIL_CEO_GROUP_REPORT')!.id;
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await svc.decide(plan, 'masil_ceo', { reject: { reason: '테스트 사유' } });
  await expect(svc.resubmit(plan, 'finance')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await expect(svc.close(plan, 'finance')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  expect((await svc.getCase(plan)).item.status).toBe('rejected');
  await svc.resubmit(plan, 'marketing');
  expect((await svc.getCase(plan)).item.status).toBe('finance_review'); // 재무 확인부터 다시
});

test('a 1st-stage return is the same rejection: finance refused, marketing may resubmit', async () => {
  const { svc } = await make({ twoStage: true });
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
  await svc.primaryReturn(CONTRACT, 'masil_ceo', '테스트 사유');
  await expect(svc.resubmit(CONTRACT, 'finance')).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  await svc.resubmit(CONTRACT, 'marketing');
  expect((await svc.getCase(CONTRACT)).item.status).toBe('finance_review');
});

test('the hold form pre-fills the owner from the topic and keeps an explicit choice', () => {
  const f = { decision: 'hold', holdNeeded: 'performance_fee_terms', holdDue: '2026-07-04' };
  expect(decisionFromForm({ ...f, holdOwner: '' })).toEqual({ hold: { needed: 'performance_fee_terms', ownerRole: 'contract', dueDate: '2026-07-04' } });
  expect(decisionFromForm({ ...f, holdOwner: 'marketing' })).toMatchObject({ hold: { ownerRole: 'marketing' } });
  expect(decisionFromForm({ ...f, holdNeeded: 'cash_outflow_date', holdOwner: '' })).toMatchObject({ hold: { ownerRole: 'finance' } });
});

test('"my turn" follows the owner of the open requests', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 }); // 대표 경로
  await svc.confirmFinance(CONTRACT, 'finance');
  await svc.submit(CONTRACT, 'marketing');
  await svc.decide(CONTRACT, 'masil_ceo', { hold: { needed: 'performance_fee_terms', ownerRole: 'contract', dueDate: '2026-07-04' } });
  const item = (await svc.listToday()).items.find((i) => i.id === CONTRACT)!;
  expect(item.status).toBe('on_hold');
  expect([...item.openRequestOwners].sort()).toEqual(['contract', 'finance']);
  expect(nextStep(item, 'contract').kind).toBe('mine');
  expect(nextStep(item, 'finance').kind).toBe('mine');
  const m = nextStep(item, 'marketing');
  expect(m.kind).toBe('waiting');
  expect(m.text).toContain('회신을 기다리는 중');
});

test('after a rejection finance sees a re-check notice, marketing sees its turn', async () => {
  const { svc } = await make();
  const plan = (await svc.listToday()).items.find((i) => i.kind === 'plan' && i.routeLevel === 'MASIL_CEO_GROUP_REPORT')!.id;
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await svc.decide(plan, 'masil_ceo', { reject: { reason: '테스트 사유' } });
  const item = (await svc.listToday()).items.find((i) => i.id === plan)!;
  expect(nextStep(item, 'marketing').kind).toBe('mine');
  const fin = nextStep(item, 'finance');
  expect(fin.kind).toBe('waiting');
  expect(fin.text).toContain('재확인');
});

test('review I-1: only the contract owner and the approvers can change the contract terms, and the real actor is logged', async () => {
  const { svc } = await make();
  for (const actor of ['marketing', 'finance'] as const) {
    await expect(svc.proposeContractChange({ actor, annualFixedFeeKrw: 900_000_000 })).rejects.toThrow(/ROLE_NOT_ALLOWED/);
  }
  expect((await svc.getCase(CONTRACT)).item.routeLevel).toBe('CEO_BOARD'); // 거부되면 아무것도 바뀌지 않는다
  await svc.proposeContractChange({ actor: 'masil_ceo', annualFixedFeeKrw: 1_800_000_000 });
  const ev = (await svc.getCase(CONTRACT)).events.find((e) => e.action === 'propose_change')!;
  expect(ev.actor_role).toBe('masil_ceo');
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  expect((await svc.getCase(CONTRACT)).item.routeLevel).toBe('MASIL_CEO');
});

test('review I-2: a reply can only carry the value that belongs to its topic', async () => {
  const { svc } = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  const perf = await reqOf(svc, 'performance_fee_terms');
  const cash = await reqOf(svc, 'cash_outflow_date');
  await expect(svc.replyInfoRequest(perf.id, { actor: 'contract', text: 'x', values: { cashOutflowDate: '2026-08-10' }, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  await expect(svc.replyInfoRequest(cash.id, { actor: 'finance', text: 'x', values: { annualFixedFeeKrw: 2_800_000_000 }, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  expect((await svc.getCase(CONTRACT)).item.routeLevel).toBe('MASIL_CEO'); // 계약 조건은 그대로
  expect((await reqOf(svc, 'cash_outflow_date')).status).toBe('requested');
  await svc.replyInfoRequest(cash.id, { actor: 'finance', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect((await reqOf(svc, 'cash_outflow_date')).status).toBe('replied');
});

test('review M-3: canReply refuses a non-role actor even when it equals a stored owner string', () => {
  expect(canReply('system', 'system')).toBe(false);
  expect(canReply('nobody', 'nobody')).toBe(false);
});
