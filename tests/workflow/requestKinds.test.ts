import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { NEEDED_PLAIN, neededLabel } from '../../app/plain.js';
import { REQUEST_KINDS, kindOf, requiredValueOf, requestLabel } from '../../src/workflow/requestKinds.js';
import { OWNER_BY_NEEDED, defaultOwnerFor, neededKo, replyKeysFor } from '../../src/workflow/ownership.js';

const C = 'CONTRACT-INF-001';
async function make() {
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  await svc.reset();
  return svc;
}

test('one definition per request kind carries code, easy names, owner, required input and explanation', () => {
  for (const k of Object.values(REQUEST_KINDS)) {
    expect(k.code).toMatch(/^[a-z_]+$/);
    expect(k.check.length).toBeGreaterThan(0);
    expect(['finance', 'contract', 'marketing']).toContain(k.owner);
  }
  expect(kindOf('cash_outflow_date')).toMatchObject({ owner: 'finance', requires: 'cashOutflowDate' });
  expect(requiredValueOf('payment_schedule')).toBeNull(); // 지급 일정은 본문으로도 완료할 수 있다
  expect(kindOf('payment_schedule')).toMatchObject({ accepts: 'cashOutflowDate' });
  expect(requiredValueOf('performance_fee_terms')).toBeNull();
  expect(kindOf('toString')).toBeNull(); // 프로토타입 키는 요청 종류가 아니다
  expect(requestLabel('free text from a hold', 'plain')).toBe('free text from a hold'); // 코드가 아니면 문장 그대로
});

test('the old lookups are views of the same definition (visible texts unchanged)', () => {
  expect(NEEDED_PLAIN.cash_outflow_date).toBe('고정 비용이 실제로 나가는 날짜');
  expect(neededLabel('performance_fee_terms')).toBe('성과 피 조건(포함하면 연 10억 원을 넘는지)');
  expect(neededKo('cash_outflow_date')).toBe('돈이 나가는 날(현금 유출일)');
  expect(requestLabel('cash_outflow_date', 'ai')).toBe('고정 피 현금 유출일(지급 일정)');
  expect(requestLabel('performance_fee_terms', 'page')).toBe('성과 피(GMV 연동) 조건 — 포함하면 연 10억 원을 넘는지');
  for (const [code, owner] of Object.entries(OWNER_BY_NEEDED)) expect(defaultOwnerFor(code)).toBe(owner);
  expect(replyKeysFor('cash_outflow_date')).toEqual(['cashOutflowDate']);
  expect(replyKeysFor('performance_fee_terms')).toEqual([]);
});

test('R5: a date request cannot be completed without a date, even with resolved=true and an empty text', async () => {
  const svc = await make();
  await svc.confirmFinance(C, 'finance');
  const req = (await svc.getCase(C)).requests.find((q) => q.needed === 'cash_outflow_date' && q.status === 'requested')!;
  await expect(svc.replyInfoRequest(req.id, { actor: 'finance', text: '', resolved: true, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  await expect(svc.replyInfoRequest(req.id, { actor: 'finance', text: '확인했습니다', resolved: true, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  const after = (await svc.getCase(C)).requests.find((q) => q.id === req.id)!;
  expect(after.status).toBe('requested');
  // 날짜가 있으면 본문이 비어 있어도 완료된다(날짜 입력 화면 경로)
  await svc.replyInfoRequest(req.id, { actor: 'finance', text: '', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect((await svc.getCase(C)).requests.find((q) => q.id === req.id)!.status).toBe('replied');
});

test('R5: a general reply needs a body; a body-less "pending" note is refused too', async () => {
  const svc = await make();
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
  const perf = (await svc.getCase(C)).requests.find((q) => q.needed === 'performance_fee_terms')!;
  await expect(svc.replyInfoRequest(perf.id, { actor: 'contract', text: '   ', resolved: true, simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  await expect(svc.replyInfoRequest(perf.id, { actor: 'contract', text: '', simulated: true })).rejects.toThrow(/INVALID_REPLY/);
  expect((await svc.getCase(C)).requests.find((q) => q.id === perf.id)!.status).toBe('requested');
  await svc.replyInfoRequest(perf.id, { actor: 'contract', text: '성과 피 별도 정산, 10억 이하', resolved: true, simulated: true });
  expect((await svc.getCase(C)).requests.find((q) => q.id === perf.id)!.status).toBe('replied');
});
