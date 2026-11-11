import { loadDataRoom, hashDataFiles } from '../../src/engine/dataRoom.js';

const room = loadDataRoom();

test('row counts', () => {
  expect(room.sample.orders).toHaveLength(15650);
  expect(room.sample.returns).toHaveLength(1719);
  expect(room.sample.budgetPlan).toHaveLength(25);
  expect(room.masters.campaigns).toHaveLength(25);
  expect(room.masters.influencers).toHaveLength(10);
  expect(room.full.purchaseOrders).toHaveLength(14);
});

test('NONE becomes null, not 0', () => {
  const perf = room.sample.adSpend.find((r) => r.media === '퍼포먼스')!;
  expect(perf.influencer_fee_krw).toBeNull();
  expect(room.full.apAging.filter((r) => r.po_id === null)).toHaveLength(10);
});

test('numeric columns are numbers', () => {
  expect(typeof room.sample.orders[0].gmv_krw).toBe('number');
  expect(typeof room.sample.costMaster[0].channel_fee_pct).toBe('number');
  expect(typeof room.sample.coupons[0].stacked_flag).toBe('boolean');
});

test('opening balance row', () => {
  const last = room.full.cashDaily.at(-1)!;
  expect(last.date).toBe('2026-06-30');
  expect(last.closing_balance).toBe(5148063540);
});

test('loading does not modify raw files', () => {
  const before = hashDataFiles();
  expect(Object.keys(before).length).toBeGreaterThan(15);
  loadDataRoom();
  expect(hashDataFiles()).toEqual(before);
});
