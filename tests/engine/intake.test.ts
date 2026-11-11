import { loadDataRoom, hashDataFiles } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS, SCENARIOS } from '../../src/engine/assumptions.js';
import { buildIntake, toCsv } from '../../src/engine/intake.js';

const room = loadDataRoom();
const rows = buildIntake(room, DEFAULT_ASSUMPTIONS);

test('26 rows sorted by effective deadline', () => {
  expect(rows).toHaveLength(26);
  expect(rows[0].실효결정기한).toBe('2026-07-17');
  const sorted = [...rows].map((r) => r.실효결정기한);
  expect(sorted).toEqual([...sorted].sort());
});

test('key rows', () => {
  const p1 = rows.find((r) => r.제안ID === 'PLAN-001')!;
  expect(p1).toMatchObject({ 승인경로: 'CEO/이사회 상신', 하회구간해당: '예', 남은일수: 16, 금액규모: '표본', 종류: '기안' });
  expect(p1.이슈).toContain('LOSS');
  expect(p1.이슈).toContain('ALLOCATION_INVERSION');
  const p7 = rows.find((r) => r.제안ID === 'PLAN-007')!;
  expect(p7).toMatchObject({ 실효결정기한: '2026-07-17', 확정기한: '2026-08-14' });
  expect(p7.이슈).toContain('EXECUTION_BEFORE_DEADLINE');
  const c = rows.find((r) => r.제안ID === 'CONTRACT-INF-001')!;
  expect(c).toMatchObject({ 종류: '전속계약', 금액규모: '풀스케일', 하회구간해당: '미확인', 승인경로: 'CEO/이사회 상신', 캠페인: '' });
  expect(c.이슈).toContain('CONTRACT_OUTFLOW_UNKNOWN');
});

test('today parameter drives remaining days and alert stage', () => {
  const r = buildIntake(room, DEFAULT_ASSUMPTIONS, '2026-07-14').find((x) => x.제안ID === 'CONTRACT-INF-001')!;
  expect(r.남은일수).toBe(3);
  expect(r.알림단계).toBe('D-3');
});

test('CSV opens in Excel with Korean headers', () => {
  const csv = toCsv(rows);
  expect(csv.startsWith('﻿제안ID,종류,')).toBe(true);
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(27);
});

test('CSV escapes commas and quotes', () => {
  const csv = toCsv([{ ...rows[0], 판정근거: 'a, "b"' }]);
  expect(csv).toContain('"a, ""b"""');
});

test('lc45 scenario changes routes, not loss issues', () => {
  const r45 = buildIntake(room, SCENARIOS.lc45);
  expect(r45.filter((r) => r.종류 === '기안' && r.승인경로 === 'CEO/이사회 상신')).toHaveLength(0);
  expect(r45.filter((r) => r.이슈.includes('LOSS'))).toHaveLength(rows.filter((r) => r.이슈.includes('LOSS')).length);
  expect(r45[0].가정세트).toContain('lc45');
});

test('full pipeline leaves raw files untouched', () => {
  const before = hashDataFiles();
  buildIntake(room, DEFAULT_ASSUMPTIONS);
  expect(hashDataFiles()).toEqual(before);
});
