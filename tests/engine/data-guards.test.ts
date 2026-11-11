import { DEFAULT_ASSUMPTIONS } from '../../src/engine/assumptions.js';
import { coerceRows, loadDataRoom, parseNumericCell } from '../../src/engine/dataRoom.js';
import { computeCampaignPerformance } from '../../src/engine/performance.js';

const room = loadDataRoom();

test('empty numeric cell is rejected with file, column and row', () => {
  const spec = { file: 'mkt_orders_ms.csv', numeric: ['gmv_krw'] };
  expect(() => coerceRows([{ gmv_krw: '' }], spec, 'mkt_orders_ms.csv')).toThrow(/mkt_orders_ms\.csv.*gmv_krw.*행 1/);
  expect(() => coerceRows([{ gmv_krw: '1' }, { gmv_krw: '  ' }], spec, 'mkt_orders_ms.csv')).toThrow(/행 2/);
  expect(() => coerceRows([{ gmv_krw: 'abc' }], spec, 'mkt_orders_ms.csv')).toThrow(/gmv_krw/);
  expect(() => coerceRows([{ gmv_krw: 'Infinity' }], spec, 'mkt_orders_ms.csv')).toThrow(/gmv_krw/);
});

test('NONE stays null and 0 stays 0', () => {
  expect(parseNumericCell(null, 'x')).toBeNull();
  expect(parseNumericCell('0', 'x')).toBe(0);
  expect(coerceRows([{ influencer_fee_krw: null }], { file: 'f', numeric: ['influencer_fee_krw'] }, 'f'))
    .toEqual([{ influencer_fee_krw: null }]);
});

test('shipping is charged once per order; only product cost scales with units', () => {
  const perf = (units: number) => computeCampaignPerformance(room, { ...DEFAULT_ASSUMPTIONS, unitsPerOrder: units })
    .find((c) => c.campaignId === 'CMP-0001')!;
  const cost = new Map(room.sample.costMaster.map((c) => [`${c.sku_id}|${c.channel_id}`, c.product_cost_krw]));
  const productCostSum = room.sample.orders
    .filter((o) => o.campaign_id === 'CMP-0001')
    .reduce((s, o) => s + cost.get(`${o.sku_id}|${o.channel_id}`)!, 0);
  expect(perf(1).contributionBeforeSpend - perf(3).contributionBeforeSpend).toBeCloseTo(2 * productCostSum, 3);
});
