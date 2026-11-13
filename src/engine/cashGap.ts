import { THRESHOLDS, type AssumptionSet } from './assumptions.js';
import { simulateCash, type BreachWindow } from './cash.js';
import type { FullTables, IsoDate } from './types.js';

/** 100,000,000 → "약 1.0억" (표시용) */
export const eok = (n: number): string => `약 ${(Math.round((n / 100_000_000) * 10) / 10).toFixed(1)}억`;

export interface CashComparison {
  /** 재무 공식 전망(주간 예상 종가)의 최저값 */
  officialMinKrw: number;
  officialBreach: boolean;
  /** 이 시스템의 일별 재계산 최저값 */
  recalcMinKrw: number;
  recalcMinDate: IsoDate;
  breaches: BreachWindow[];
  /** 공식 전망과 재계산의 하회 판정이 다르면 재무 확인이 필요하다 */
  needsFinanceCheck: boolean;
  /** LC-0001을 45일 조건으로 재계산하면 하회가 사라지는지(재계산으로 확인한 사실) */
  lc45RemovesBreach: boolean;
  /** 확인된 사실만 적은 문장(원인을 단정하지 않는다) */
  lines: string[];
  /** 아직 확인되지 않은 것 */
  unverified: string[];
}

/** 공식 현금 전망과의 차이. 원인은 단정하지 않고 재계산으로 확인된 사실만 적는다. */
export function cashComparison(full: FullTables, a: AssumptionSet): CashComparison {
  const base = simulateCash(full, a);
  const lc45 = simulateCash(full, { ...a, lc0001TermsDays: 45 });
  const officialBreach = base.officialMinClosing < THRESHOLDS.covenantMinKrw;
  const hasBreach = base.breaches.length > 0;
  const lc45Removes = hasBreach && a.lc0001TermsDays !== 45 && lc45.breaches.length === 0;
  const w = base.breaches.map((b) => `${b.start.slice(5).replace('-', '/')}~${b.end.slice(5).replace('-', '/')}`).join(', ');
  const lines = [
    `재무 공식 전망 최저 ${eok(base.officialMinClosing)}(하회 ${officialBreach ? '있음' : '없음'})`,
    `재계산 최저 ${eok(base.minimum.balance)}(${hasBreach ? `${w} 하회` : '하회 없음'})`,
  ];
  if (lc45Removes) lines.push('LC-0001을 45일 조건으로 가정하면 공식 전망처럼 하회가 사라진다(재계산 결과)');
  return {
    officialMinKrw: base.officialMinClosing, officialBreach,
    recalcMinKrw: base.minimum.balance, recalcMinDate: base.minimum.date, breaches: base.breaches,
    needsFinanceCheck: officialBreach !== hasBreach, lc45RemovesBreach: lc45Removes, lines,
    unverified: ['7/21 발주대금이 공식 전망에 반영됐는지: 미확인', '연체 매출채권·매입채무를 공식 전망이 어떻게 처리했는지: 미확인'],
  };
}
