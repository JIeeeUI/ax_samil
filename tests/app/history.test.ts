import { historyEntry } from '../../src/app/history.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { formatClock } from '../../src/format.js';
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

test('the real time is shown as hour:minute in Korea time, separate from the business date', () => {
  expect(formatClock('2026-11-13T00:05:00.000Z')).toBe('09:05');
  expect(formatClock('2026-11-12T15:30:00.000Z')).toBe('00:30'); // 날짜가 넘어가도 시:분만
  expect(formatClock('not a time')).toBe('—');
});

test('every history entry has a time, a sender and a recipient (or a dash)', async () => {
  const svc = await make();
  await svc.confirmFinance(C, 'finance');
  await svc.submit(C, 'marketing');
  await svc.decide(C, 'ceo_board', { hold: { needed: 'cash_outflow_date', ownerRole: 'finance', dueDate: '2026-07-08' } });
  const d = await svc.getCase(C);
  expect(d.history).toHaveLength(d.events.length);
  for (const h of d.history) {
    expect(h.time).toMatch(/^\d{2}:\d{2}$/);
    expect(h.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.from.name.length).toBeGreaterThan(0);
  }
  const by = (a: string) => d.history.find((h) => h.action === a)!;
  expect(by('received')).toMatchObject({ from: { role: 'system', name: '자동 처리' }, to: null });
  expect(by('confirm_finance')).toMatchObject({ from: { role: 'finance', team: '재무팀' }, to: { role: 'marketing', label: '마케팅팀(마케팅 담당자)' } });
  expect(by('submit')).toMatchObject({ from: { team: '마케팅팀' }, to: { role: 'ceo_board', label: 'CEO/이사회' } });
  expect(by('hold')).toMatchObject({ from: { team: 'CEO/이사회' }, to: { role: 'finance', label: '재무팀(재무 담당자)' } });
});

test('resubmission goes from marketing to finance; "recipient" wording is never used', async () => {
  const svc = await make();
  const plan = 'PLAN-004';
  await svc.confirmFinance(plan, 'finance');
  await svc.submit(plan, 'marketing');
  await svc.decide(plan, 'masil_ceo', { reject: { reason: '재검토' } });
  await svc.resubmit(plan, 'marketing');
  const h = (await svc.getCase(plan)).history;
  const re = h.find((x) => x.action === 'resubmit')!;
  expect(re.from.team).toBe('마케팅팀');
  expect(re.to!.label).toBe('재무팀(재무 담당자)');
  expect(JSON.stringify(h)).not.toContain('받는 사람');
});

test('entries without a receiving side have no recipient, and a system action is "자동 처리"', () => {
  const base = { id: 1, case_id: 'X', business_date: '2026-07-01', real_time: '2026-07-01T01:00:00.000Z', detail: null, snapshot: { route: 'CEO_BOARD' }, assumption_version: 'v', simulated: false };
  expect(historyEntry({ ...base, actor_role: 'system', action: 'expire' })).toMatchObject({ to: null, from: { name: '자동 처리' }, time: '10:00' });
  expect(historyEntry({ ...base, actor_role: 'marketing', action: 'close' }).to).toBeNull();
  expect(historyEntry({ ...base, actor_role: 'nobody', action: 'whatever' }).from.name).toBe('nobody'); // 알 수 없는 기록도 깨지지 않는다
});
