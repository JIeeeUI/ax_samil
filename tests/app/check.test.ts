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
  expect(v.cashComparison.lines[0]).toBe('재무 공식 전망 최저 약 54.7억(하회 없음)');
  expect(v.cashComparison.lines[1]).toContain('재계산 최저 약 16.5억');
  expect((await svc.getCase('PLAN-019')).cashComparison.lc45RemovesBreach).toBe(true);
  await svc.setScenario('lc45');
  expect((await svc.listToday()).cashComparison.needsFinanceCheck).toBe(false);
});
