import { addDays, daysBetween } from '../engine/calendar.js';
import type { IsoDate } from '../engine/types.js';

/**
 * 역산 일정: 시간 규칙을 "실효 결정 기한"에서 거꾸로 센다는 하나의 원칙으로 모은다. [교육용 가정]
 *   결재자 몫      D-3 ~ D-0   (그래서 1차 보류 상한은 기한 3일 전)
 *   재무 재확인 몫 D-5 ~ D-3
 *   마케팅·협의 몫 D-5 이전
 * 기존 값(보류 상한 3일, 긴급 10일, 알림 14/7/3일, 확인 요청 +3일)은 바꾸지 않는다.
 */
export const SCHEDULE = {
  approverDays: 3,
  financeRecheckDays: 5,
  /** 반려 회신 여유(반려일 기준) */
  replyDays: 3,
  /** 실효 기한까지 이 일수 이하이면 반려하지 않고 의견만 붙여 상신한다 */
  noReturnWithinDays: 5,
} as const;

/** 반려 회신 기한 = min(반려일 + 3일, 실효 기한 − 5일) */
export function returnDueDate(returnDate: IsoDate, effectiveDeadline: IsoDate): IsoDate {
  const byRule = addDays(returnDate, SCHEDULE.replyDays);
  const byDeadline = addDays(effectiveDeadline, -SCHEDULE.noReturnWithinDays);
  return byRule < byDeadline ? byRule : byDeadline;
}

/** 실효 기한까지 5일을 넘게 남았을 때만 반려할 수 있다. */
export function canReturn(today: IsoDate, effectiveDeadline: IsoDate): boolean {
  return daysBetween(today, effectiveDeadline) > SCHEDULE.noReturnWithinDays;
}

export interface BackwardWindows {
  approver: { from: IsoDate; to: IsoDate };
  financeRecheck: { from: IsoDate; to: IsoDate };
  marketingBefore: IsoDate;
}

export function backwardWindows(effectiveDeadline: IsoDate): BackwardWindows {
  return {
    approver: { from: addDays(effectiveDeadline, -SCHEDULE.approverDays), to: effectiveDeadline },
    financeRecheck: { from: addDays(effectiveDeadline, -SCHEDULE.financeRecheckDays), to: addDays(effectiveDeadline, -SCHEDULE.approverDays) },
    marketingBefore: addDays(effectiveDeadline, -SCHEDULE.financeRecheckDays),
  };
}

/** 재무 반려 사유 목록(설정에서 켜고 끈다) */
export const RETURN_REASON_LABEL = {
  cash_breach: '현금 위험 구간',
  loss_or_inversion: '손실 캠페인·배분 역전',
  weak_basis: '근거 부족(예상 GMV)',
  other: '기타',
} as const;
export type ReturnReason = keyof typeof RETURN_REASON_LABEL;
export const RETURN_REASONS = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];
export const isReturnReason = (v: unknown): v is ReturnReason => typeof v === 'string' && Object.hasOwn(RETURN_REASON_LABEL, v);
