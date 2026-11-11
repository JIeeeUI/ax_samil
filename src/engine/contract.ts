import type { IsoDate } from './types.js';

/** 갱신 후 1년 계약 기간 [가정: 현 계약 만료 2026-08-31 다음 날부터] */
export const RENEWAL_TERM = { start: '2026-09-01', end: '2027-08-31' } as const;

const ym = (d: IsoDate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));

/**
 * 갱신 후 중도 해지 위약금 = 연 고정 피 × 50% × 잔여 월수 ÷ 12.
 * 월 단위로 센다(해지 달은 사용한 달). 갱신 시작일 당일 이전 해지는 12개월. 계약 원문 미확인 [가정].
 */
export function terminationPenalty(
  annualFeeKrw: number, terminationDate: IsoDate, term: { start: IsoDate; end: IsoDate } = RENEWAL_TERM,
): number {
  const remaining = terminationDate <= term.start ? 12 : Math.max(0, ym(term.end) - ym(terminationDate));
  return Math.round((annualFeeKrw * 0.5 * remaining) / 12);
}
