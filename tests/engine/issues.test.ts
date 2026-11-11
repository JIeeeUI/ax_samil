import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { DEFAULT_ASSUMPTIONS } from '../../src/engine/assumptions.js';
import { computeCampaignPerformance, computeInfluencerPerformance } from '../../src/engine/performance.js';
import { buildCases } from '../../src/engine/cases.js';
import { evaluateIssues, channelReturnBenchmark, type IssueCode } from '../../src/engine/issues.js';

const room = loadDataRoom();
const campaigns = computeCampaignPerformance(room, DEFAULT_ASSUMPTIONS);
const influencers = computeInfluencerPerformance(room, DEFAULT_ASSUMPTIONS);
const cases = buildCases(room);
const channelBenchmark = channelReturnBenchmark(room);
const issues = evaluateIssues({ campaigns, influencers, cases, channelBenchmark });
const ids = (code: IssueCode) => issues.filter((i) => i.code === code).map((i) => i.targetId).sort();

test('channel benchmark in percent', () => {
  expect(channelBenchmark['마켓플레이스']).toBe(9.0);
  expect(channelBenchmark['자사몰']).toBe(8.5);
});

test('loss campaigns', () => {
  expect(ids('LOSS')).toEqual(['CMP-0001', 'CMP-0002', 'CMP-0003', 'CMP-0012', 'CMP-0013', 'CMP-0014']);
});

test('allocation inversion', () => {
  expect(ids('ALLOCATION_INVERSION')).toEqual(['INF-001', 'INF-005']);
});

test('return rate vs channel benchmark', () => {
  expect(ids('RETURN_RATE_ISSUE')).toEqual(expect.arrayContaining(['CMP-0013', 'CMP-0014'])); // 마켓 9.0% 대비 +3.4, +3.9%p
  expect(ids('RETURN_RATE_WARN')).toContain('CMP-0012'); // 10.4%
  expect([...ids('RETURN_RATE_WARN'), ...ids('RETURN_RATE_ISSUE')]).not.toContain('CMP-0023'); // 자사몰 1.9%
  // 한 캠페인에 WARN과 ISSUE가 동시에 붙지 않는다
  expect(ids('RETURN_RATE_WARN').filter((x) => ids('RETURN_RATE_ISSUE').includes(x))).toEqual([]);
});

test('no sample-size holds in source data, but synthetic small campaign is held', () => {
  expect(ids('SAMPLE_TOO_SMALL')).toEqual([]);
  const small = { ...campaigns[0], campaignId: 'CMP-TEST', orders: 99, realRoas: -1 };
  const r = evaluateIssues({ campaigns: [small], influencers: [], cases: [], channelBenchmark });
  expect(r.map((i) => i.code)).toEqual(['SAMPLE_TOO_SMALL']);
});

test('case-level issues', () => {
  expect(ids('EXECUTION_BEFORE_DEADLINE')).toHaveLength(12);
  expect(ids('CONTRACT_OUTFLOW_UNKNOWN')).toEqual(['CONTRACT-INF-001']);
});

test('labels and evidence', () => {
  expect(issues.find((i) => i.code === 'ALLOCATION_INVERSION')!.label).toBe('assumption');
  expect(issues.find((i) => i.code === 'LOSS')!.label).toBe('confirmed');
  expect(issues.find((i) => i.code === 'RETURN_RATE_ISSUE')!.label).toBe('benchmark');
  expect(issues.find((i) => i.targetId === 'CMP-0014' && i.code === 'RETURN_RATE_ISSUE')!.evidence).toContain('9.0%');
  expect(issues.every((i) => i.evidence.length > 0)).toBe(true);
});
