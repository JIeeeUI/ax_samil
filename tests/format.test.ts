import { approxMan, formatMan } from '../src/format.js';
import { shortWon } from '../app/plain.js';
import { won } from '../app/components.js';

test('amounts are shown in units of 10,000 won with thousands commas and no 억 unit', () => {
  expect(formatMan(2_800_000_000)).toBe('280,000만 원');
  expect(formatMan(18_960_000)).toBe('1,896만 원');
  expect(formatMan(1_800_000_000)).toBe('180,000만 원');
  expect(formatMan(100_000_000)).toBe('10,000만 원');
});

test('under 10,000 won it stays in won; the remainder under 10,000 is rounded', () => {
  expect(formatMan(0)).toBe('0원');
  expect(formatMan(9_999)).toBe('9,999원');
  expect(formatMan(10_000)).toBe('1만 원');
  expect(formatMan(18_962_703)).toBe('1,896만 원');
  expect(formatMan(14_926_612)).toBe('1,493만 원');
  expect(formatMan(14_925_000)).toBe('1,493만 원'); // .5 올림
  expect(formatMan(180_803_272)).toBe('18,080만 원');
});

test('negative amounts keep the sign', () => {
  expect(formatMan(-18_962_703)).toBe('-1,896만 원');
  expect(formatMan(-500)).toBe('-500원');
});

test('the approximate form for forecasts', () => {
  expect(approxMan(5_468_884_369)).toBe('약 546,888만 원');
  expect(approxMan(1_647_835_595)).toBe('약 164,784만 원');
});

test('the screen helpers use the shared function', () => {
  expect(shortWon(2_800_000_000)).toBe(formatMan(2_800_000_000));
  expect(won(18_962_703)).toBe(formatMan(18_962_703));
});
