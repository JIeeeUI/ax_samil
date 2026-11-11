import { THRESHOLDS, type AssumptionSet } from './assumptions.js';
import { addDays, businessDaysInRange, nextBusinessDay } from './calendar.js';
import type { FullTables, IsoDate } from './types.js';

export interface CashResult {
  opening: number;
  daily: { date: IsoDate; balance: number }[];
  breach: { start: IsoDate; end: IsoDate; businessDays: number } | null;
  minimum: { date: IsoDate; balance: number };
  /** 재무 공식 전망(fin_cash_forecast_ms)의 주간 예상 종가 최소값 — 대조용 */
  officialMinClosing: number;
}

const LC0001_CHANNEL = 'CH-03';

/**
 * 향후 현금 재시뮬레이션 (calculation_definitions 1.2, covenant_terms_ms).
 * 풀스케일 계열만 받는다(표본 계열과 섞지 않음).
 * 기준일 이후 이미 잡힌 회수·지급 일정만 합산하므로 새 매출의 회수는 들어가지 않는 보수적 전망이다.
 */
export function simulateCash(full: FullTables, a: AssumptionSet, horizonEnd: IsoDate = '2026-09-30'): CashResult {
  const asOf = a.asOf;
  const events = new Map<IsoDate, number>();
  const put = (date: IsoDate, amount: number) => {
    const d = nextBusinessDay(date);
    events.set(d, (events.get(d) ?? 0) + amount);
  };
  /** 기준일 전 일정: 정책에 따라 기준일로 옮기거나 제외 */
  const place = (due: IsoDate, policy: 'asof' | 'exclude'): IsoDate | null =>
    due >= asOf ? due : policy === 'asof' ? asOf : null;

  for (const r of full.arAging) {
    const due = r.channel_id === LC0001_CHANNEL && a.lc0001TermsDays === 45 ? addDays(r.invoice_date, 45) : r.due_date;
    const d = place(due, a.overdueAr);
    if (d) put(d, r.outstanding_krw);
  }
  for (const r of full.apAging) {
    if (r.po_id !== null) continue; // 발주 연결분은 발주 파일에서 한 번만 (이중 계상 방지)
    const d = place(r.payment_due_date, a.overdueAp);
    if (d) put(d, -r.amount_krw);
  }
  for (const p of full.purchaseOrders) put(p.payment_due_date, -p.amount_krw);

  const opening = full.cashDaily.at(-1)!.closing_balance;
  let balance = opening;
  const daily = businessDaysInRange(asOf, horizonEnd).map((date) => {
    balance += events.get(date) ?? 0;
    return { date, balance };
  });

  const below = daily.filter((d) => d.balance < THRESHOLDS.covenantMinKrw);
  const breach = below.length === 0 ? null : { start: below[0].date, end: below.at(-1)!.date, businessDays: below.length };
  const minimum = daily.reduce((m, d) => (d.balance < m.balance ? d : m), daily[0]);
  const officialMinClosing = Math.min(...full.cashForecast.map((f) => f.projected_closing_krw));
  return { opening, daily, breach, minimum, officialMinClosing };
}

export function isInBreach(date: IsoDate, breach: CashResult['breach']): boolean {
  return breach !== null && date >= breach.start && date <= breach.end;
}

/** 실적 구간 항등식(기초 + 유입 − 유출 = 기말)이 깨진 날만 반환. */
export function checkActualIdentity(full: FullTables): { date: IsoDate; diff: number }[] {
  return full.cashDaily
    .map((r) => ({ date: r.date, diff: r.opening_balance + r.inflow_krw - r.outflow_krw - r.closing_balance }))
    .filter((x) => x.diff !== 0);
}
