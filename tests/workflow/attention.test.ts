import { ATTENTION_TABLE, MERGE_INTO, buildAttention, compareByAttention } from '../../src/workflow/attention.js';

const base = { inBreach: '아니오' as const, provisional: false, effectiveDeadline: '2026-07-17' };

test('draft tiers: high / mid / low as agreed', () => {
  const tier = (c: keyof typeof ATTENTION_TABLE) => ATTENTION_TABLE[c].tier;
  for (const c of ['CONTRACT_OUTFLOW_UNKNOWN', 'EXECUTION_BEFORE_DEADLINE', 'LOSS'] as const) expect(tier(c)).toBe('high');
  for (const c of ['ALLOCATION_INVERSION', 'RETURN_RATE_ISSUE'] as const) expect(tier(c)).toBe('mid');
  for (const c of ['RETURN_RATE_WARN', 'DISCOUNT_ABOVE_AVG', 'SAMPLE_TOO_SMALL'] as const) expect(tier(c)).toBe('low');
  // 현금 부족 구간·연결 그룹 경고는 코드를 보고 상으로 둔다
  expect(tier('CASH_BREACH')).toBe('high');
  expect(tier('AUTO_RENEW')).toBe('high');
  for (const r of Object.values(ATTENTION_TABLE)) expect(r.why.length).toBeGreaterThan(0);
});

test('items are sorted high → mid → low and the top tag is the most important one', () => {
  const a = buildAttention({ ...base, issues: ['DISCOUNT_ABOVE_AVG', 'RETURN_RATE_ISSUE', 'EXECUTION_BEFORE_DEADLINE'] });
  expect(a.items.map((i) => i.tier)).toEqual(['high', 'mid', 'low']);
  expect(a.top).toEqual({ code: 'EXECUTION_BEFORE_DEADLINE', tier: 'high', tag: '확정 전 집행' });
  expect(a.count).toBe(3);
});

test('same-meaning warnings merge into one representative with the rest as detail', () => {
  const loss = buildAttention({ ...base, issues: ['LOSS', 'ALLOCATION_INVERSION'] });
  expect(loss.items.map((i) => i.code)).toEqual(['LOSS']);
  expect(loss.items[0].details).toContain(ATTENTION_TABLE.ALLOCATION_INVERSION.text);
  const ret = buildAttention({ ...base, issues: ['RETURN_RATE_ISSUE', 'RETURN_RATE_WARN'] });
  expect(ret.items.map((i) => i.code)).toEqual(['RETURN_RATE_ISSUE']);
  const unknown = buildAttention({ ...base, inBreach: '미확인', issues: ['CONTRACT_OUTFLOW_UNKNOWN'] });
  expect(unknown.items.map((i) => i.code)).toEqual(['CONTRACT_OUTFLOW_UNKNOWN']);
  expect(unknown.count).toBe(1);
  const renew = buildAttention({ ...base, issues: [], linkWarning: '기안만 부결, 계약은 자동 갱신', autoRenewWarning: '통보 미완료 시 자동 갱신' });
  expect(renew.items.map((i) => i.code)).toEqual(['AUTO_RENEW']);
  expect(renew.items[0].details).toHaveLength(2);
  expect(MERGE_INTO.ALLOCATION_INVERSION).toBe('LOSS');
});

test('an absorbed code stands alone when its representative is absent', () => {
  expect(buildAttention({ ...base, issues: ['ALLOCATION_INVERSION'] }).items.map((i) => i.code)).toEqual(['ALLOCATION_INVERSION']);
  expect(buildAttention({ ...base, issues: ['RETURN_RATE_WARN'] }).items.map((i) => i.code)).toEqual(['RETURN_RATE_WARN']);
});

test('cash breach and provisional route are items; nothing to watch gives an empty result', () => {
  const a = buildAttention({ ...base, inBreach: '예', provisional: true, issues: [] });
  expect(a.items.map((i) => i.code)).toEqual(['CASH_BREACH', 'PROVISIONAL_ROUTE']);
  expect(buildAttention({ ...base, issues: [] })).toEqual({ count: 0, top: null, items: [] });
});

test('cases sort by their top tier, then by the nearer deadline; cases without attention go last', () => {
  const mk = (issues: string[], d: string) => ({ attention: buildAttention({ ...base, issues, effectiveDeadline: d }), effectiveDeadline: d });
  const list = [mk([], '2026-07-01'), mk(['DISCOUNT_ABOVE_AVG'], '2026-07-02'), mk(['LOSS'], '2026-08-01'), mk(['LOSS'], '2026-07-10')];
  const sorted = [...list].sort(compareByAttention);
  expect(sorted.map((x) => [x.attention.top?.tier ?? '-', x.effectiveDeadline])).toEqual([
    ['high', '2026-07-10'], ['high', '2026-08-01'], ['low', '2026-07-02'], ['-', '2026-07-01'],
  ]);
});
