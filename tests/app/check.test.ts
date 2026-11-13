import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function make() {
  const repo = new Repo(await openDb({}));
  await repo.migrate();
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return svc;
}

test('the service result carries the official-forecast gap for the list and for a case', async () => {
  const svc = await make();
  const v = await svc.listToday();
  expect(v.cashComparison.needsFinanceCheck).toBe(true);
  expect(v.cashComparison.lines[0]).toBe('재무 공식 전망 최저 약 546,888만 원(하회 없음)');
  expect(v.cashComparison.lines[1]).toContain('재계산 최저 약 164,784만 원');
  expect((await svc.getCase('PLAN-019')).cashComparison.lc45RemovesBreach).toBe(true);
  await svc.setScenario('lc45');
  expect((await svc.listToday()).cashComparison.needsFinanceCheck).toBe(false);
});

test('check labels are derived from the existing state and open requests', async () => {
  const svc = await make();
  const label = async (id: string) => (await svc.listToday()).items.find((i) => i.id === id)!.checkLabel;
  expect(await label('PLAN-019')).toBe('finance_pending'); // 점검 통과, 아직 재무 확인 전
  expect(await label('CONTRACT-INF-001')).toBe('waiting_info'); // 현금 유출일 미확인
  await svc.confirmFinance('CONTRACT-INF-001', 'finance'); // 확인 요청이 생긴다
  expect(await label('CONTRACT-INF-001')).toBe('waiting_info');
  await svc.confirmFinance('PLAN-019', 'finance');
  expect(await label('PLAN-019')).toBe('ready'); // 재무 확인이 끝나 상신할 수 있다
  await svc.submit('PLAN-019', 'marketing');
  expect(await label('PLAN-019')).toBe('submitted');
  const q = (await svc.getCase('CONTRACT-INF-001')).requests.find((r) => r.status === 'requested')!;
  await svc.replyInfoRequest(q.id, { actor: 'finance', text: '9/30 지급', values: { cashOutflowDate: '2026-09-30' }, simulated: true });
  expect(await label('CONTRACT-INF-001')).toBe('ready');
});

test('the four-line check result: who approves, deadline, evidence, missing information', async () => {
  const svc = await make();
  const c = (await svc.getCase('PLAN-001')).check;
  expect(c.lines).toHaveLength(4);
  expect(c.lines[0]).toMatch(/CEO\/이사회/);
  expect(c.lines[1]).toContain('2026-07-17');
  expect(c.lines[1]).toContain('되돌릴 수 없');
  expect(c.lines[2]).toContain('명목');
  expect(c.lines[2]).toContain('실질');
  expect(c.lines[2]).toContain('재무 공식 전망');
  expect(c.lines[3]).toContain('없음');
  expect(c.evidence.influencerRealRoasDemandOnly!).toBeCloseTo(-0.11, 1);
  expect(c.evidence.stillLoss).toBe(true);
  const k = (await svc.getCase('CONTRACT-INF-001')).check;
  expect(k.lines[3]).toContain('Masil 재무팀');
  expect(k.lines[3]).toContain('돈이 나가는 날');
});

test('submitting from the screen needs the extra confirmation; the service call itself is unchanged', async () => {
  const { commands } = await import('../../src/app/commands.js');
  const svc = await make();
  await svc.confirmFinance('PLAN-019', 'finance');
  const c = commands(svc);
  expect(await c.submit('PLAN-019', 'marketing', false)).toMatchObject({ ok: false });
  expect((await svc.getCase('PLAN-019')).item.status).toBe('routed');
  expect(await c.submit('PLAN-019', 'marketing', true)).toEqual({ ok: true });
  expect((await svc.getCase('PLAN-019')).item.status).toBe('submitted');
});

test('the post-approval features switch is off by default and validated', async () => {
  const svc = await make();
  expect((await svc.getConfig()).showExtended).toBe(false);
  await svc.setConfig({ showExtended: true });
  expect((await svc.getConfig()).showExtended).toBe(true);
  await expect(svc.setConfig({ showExtended: 'yes' as never })).rejects.toThrow(/INVALID_CONFIG/);
  // 숨기는 것은 화면뿐이다: 꺼져 있어도 서비스 기능은 그대로 동작한다
  await svc.setConfig({ showExtended: false });
  await svc.financeReturn('PLAN-001', 'finance', { reasons: ['cash_breach'], opinion: '확인' });
  expect((await svc.getCase('PLAN-001')).item.status).toBe('revision');
});

test('review: expired cases get no check label; the evaluation view never changes issues or routes', async () => {
  const svc = await make();
  const before = (await svc.listToday()).items.map((i) => [i.id, i.routeLevel, i.issues.join(';'), i.realRank]);
  await svc.advanceClock('2026-07-18');
  expect((await svc.listToday()).items.find((i) => i.id === 'PLAN-001')!.checkLabel).toBeNull();
  const svc2 = await make();
  expect((await svc2.listToday()).items.map((i) => [i.id, i.routeLevel, i.issues.join(';'), i.realRank])).toEqual(before);
  expect((await svc2.getCase('PLAN-002')).check.evidence.realRoasDemandOnly).not.toBe((await svc2.getCase('PLAN-002')).check.evidence.realRoas);
});

test('a reply that arrives before the finance check leaves the label at finance_pending', async () => {
  const svc = await make();
  const c = 'CONTRACT-INF-001';
  const label = async () => (await svc.listToday()).items.find((i) => i.id === c)!.checkLabel;
  await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 1_800_000_000 }); // 현금 유출일 확인 요청이 생긴다(재무 확인 전)
  expect(await label()).toBe('waiting_info');
  for (const q of (await svc.getCase(c)).requests.filter((r) => r.status === 'requested')) {
    await svc.replyInfoRequest(q.id, q.needed === 'cash_outflow_date'
      ? { actor: 'finance', text: '9/30', values: { cashOutflowDate: '2026-09-30' }, simulated: true }
      : { actor: 'contract', text: '성과 피 별도, 10억 이하', simulated: true, resolved: true });
  }
  const d = await svc.getCase(c);
  expect(d.item.status).toBe('finance_review');
  expect(await label()).toBe('finance_pending');
  expect(d.check.lines[3]).toContain('재무');
  await svc.confirmFinance(c, 'finance');
  expect(await label()).toBe('ready');
});
