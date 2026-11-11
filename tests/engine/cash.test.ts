import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { SCENARIOS, type ScenarioId } from '../../src/engine/assumptions.js';
import { simulateCash, checkActualIdentity, isInBreach } from '../../src/engine/cash.js';

const room = loadDataRoom();
const R = (id: ScenarioId) => simulateCash(room.full, SCENARIOS[id]);

test('actual period identity holds', () => {
  expect(checkActualIdentity(room.full)).toEqual([]);
});

test('baseline breach window', () => {
  const r = R('baseline');
  expect(r.opening).toBe(5148063540);
  expect(r.breach).toEqual({ start: '2026-07-21', end: '2026-08-21', businessDays: 24 });
  expect(r.minimum).toEqual({ date: '2026-07-27', balance: 1647835595 });
  expect(r.officialMinClosing).toBe(5468884369);
});

test('scenario sensitivity', () => {
  expect(R('arOverdueExcluded').breach).toEqual({ start: '2026-07-21', end: '2026-08-28', businessDays: 29 });
  // 사전 계산은 억 단위 소수 둘째 자리 반올림값만 확인했으므로 0.05억 허용
  expect(R('arOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(14.68, 1);
  expect(R('apOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(21.02, 1);
  expect(R('bothOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(19.22, 1);
  expect(R('lc45').breach).toBeNull();
  expect(R('lc45').minimum.date).toBe('2026-07-22');
  expect(R('lc45').minimum.balance / 1e8).toBeCloseTo(48.35, 1);
});

test('weekend collections roll to Monday', () => {
  // LC-0001 회수 예정 2026-08-23(일) → 08-24에 반영되어 그날 하회가 끝난다
  const r = R('baseline');
  expect(r.daily.find((d) => d.date === '2026-08-24')!.balance).toBeGreaterThanOrEqual(3000000000);
  expect(r.daily.some((d) => d.date === '2026-08-23')).toBe(false);
});

test('isInBreach is inclusive at both ends', () => {
  const b = R('baseline').breach;
  expect(isInBreach('2026-07-21', b)).toBe(true);
  expect(isInBreach('2026-08-21', b)).toBe(true);
  expect(isInBreach('2026-08-24', b)).toBe(false);
  expect(isInBreach('2026-07-20', null)).toBe(false);
});
