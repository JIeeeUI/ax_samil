import { addDays, daysBetween, isBusinessDay, nextBusinessDay, businessDaysInRange, minDate } from '../../src/engine/calendar.js';

test('weekend rolls to Monday', () => {
  expect(nextBusinessDay('2026-08-23')).toBe('2026-08-24'); // 일요일
  expect(nextBusinessDay('2026-07-04')).toBe('2026-07-06'); // 토요일
  expect(nextBusinessDay('2026-07-21')).toBe('2026-07-21');
});

test('calendar days', () => {
  expect(daysBetween('2026-07-01', '2026-07-17')).toBe(16);
  expect(daysBetween('2026-07-18', '2026-07-17')).toBe(-1);
  expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
});

test('business days', () => {
  expect(isBusinessDay('2026-07-25')).toBe(false);
  expect(businessDaysInRange('2026-07-21', '2026-08-21')).toHaveLength(24);
});

test('minDate ignores null', () => {
  expect(minDate('2026-08-14', '2026-07-17')).toBe('2026-07-17');
  expect(minDate('2026-07-17', null)).toBe('2026-07-17');
});
