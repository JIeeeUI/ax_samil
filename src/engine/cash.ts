import { THRESHOLDS, type AssumptionSet } from './assumptions.js';
import { addDays, businessDaysInRange, nextBusinessDay, previousBusinessDay } from './calendar.js';
import type { FullTables, IsoDate } from './types.js';

/** 연속된 하회 영업일 한 구간 (주말은 연속을 끊지 않는다). */
export interface BreachWindow { start: IsoDate; end: IsoDate; businessDays: number }

export interface CashResult {
  opening: number;
  /** 기초 잔액을 가져온 실적일(기준일 직전 영업일) */
  openingDate: IsoDate;
  daily: { date: IsoDate; balance: number }[];
  /** 하회 구간들(없으면 빈 배열). 떨어진 구간은 합치지 않는다. */
  breaches: BreachWindow[];
  minimum: { date: IsoDate; balance: number };
  /** 재무 공식 전망(fin_cash_forecast_ms)의 주간 예상 종가 최소값 — 대조용 */
  officialMinClosing: number;
}

const LC0001_CHANNEL = 'CH-03';

/**
 * 미리 계산한 결과로 현금 시뮬레이션을 대신하는 장치(원본 행을 싣지 않는 정적 시연판용).
 * 설치하지 않으면 아래 계산이 그대로 돈다.
 */
export type CashProvider = (a: AssumptionSet, horizonEnd: IsoDate) => CashResult;
let cashProvider: CashProvider | null = null;
export function installCashProvider(p: CashProvider | null): void { cashProvider = p; }

/**
 * 향후 현금 재시뮬레이션 (calculation_definitions 1.2, covenant_terms_ms).
 * 풀스케일 계열만 받는다(표본 계열과 섞지 않음).
 * 기준일 이후 이미 잡힌 회수·지급 일정만 합산하므로 새 매출의 회수는 들어가지 않는 보수적 전망이다.
 */
export function simulateCash(full: FullTables, a: AssumptionSet, horizonEnd: IsoDate = '2026-09-30'): CashResult {
  if (cashProvider) return cashProvider(a, horizonEnd);
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
  const poIds = new Set(full.purchaseOrders.map((p) => p.po_id));
  for (const r of full.apAging) {
    // 발주 파일에 있는 발주 연결분만 제외 (이중 계상 방지). 발주 파일에 없는 po_id는 지급으로 센다.
    if (r.po_id !== null && poIds.has(r.po_id)) continue;
    const d = place(r.payment_due_date, a.overdueAp);
    if (d) put(d, -r.amount_krw);
  }
  // 기준일 전 발주 대금도 연체 매입채무와 같은 정책으로 처리한다 [가정]
  for (const p of full.purchaseOrders) {
    const d = place(p.payment_due_date, a.overdueAp);
    if (d) put(d, -p.amount_krw);
  }

  // 기초 잔액 = 기준일 직전 영업일 종가. 실적이 그 날까지 없거나 기준일을 포함하면 실적과 예정이 어긋나므로 중단한다.
  const lastActual = full.cashDaily.at(-1);
  const wantDate = previousBusinessDay(asOf);
  if (!lastActual || lastActual.date < wantDate || lastActual.date >= asOf) {
    throw new Error(`기초 잔액 오류: 기준일 ${asOf}의 직전 영업일(${wantDate}) 종가가 필요하지만 마지막 실적일은 ${lastActual?.date ?? '없음'}입니다`);
  }
  const opening = lastActual.closing_balance;
  const openingDate = lastActual.date;
  let balance = opening;
  const daily = businessDaysInRange(asOf, horizonEnd).map((date) => {
    balance += events.get(date) ?? 0;
    return { date, balance };
  });

  const breaches: BreachWindow[] = [];
  // daily는 영업일만 담으므로, 바로 앞 영업일도 하회였을 때만 같은 구간으로 이어진다.
  daily.forEach((d, i) => {
    if (d.balance >= THRESHOLDS.covenantMinKrw) return;
    const cont = i > 0 && daily[i - 1].balance < THRESHOLDS.covenantMinKrw;
    if (cont) { const w = breaches.at(-1)!; w.end = d.date; w.businessDays += 1; }
    else breaches.push({ start: d.date, end: d.date, businessDays: 1 });
  });
  const minimum = daily.reduce((m, d) => (d.balance < m.balance ? d : m), daily[0]);
  const officialMinClosing = Math.min(...full.cashForecast.map((f) => f.projected_closing_krw));
  return { opening, openingDate, daily, breaches, minimum, officialMinClosing };
}

export function isInBreach(date: IsoDate, breaches: BreachWindow[]): boolean {
  return breaches.some((b) => date >= b.start && date <= b.end);
}

/** 주말 유출은 다음 영업일에 실제로 나가므로 이월한 날짜가 속한 구간을 돌려준다. */
export function breachWindowFor(date: IsoDate, breaches: BreachWindow[]): BreachWindow | null {
  const d = nextBusinessDay(date);
  return breaches.find((b) => d >= b.start && d <= b.end) ?? null;
}

/** 현금 유출일이 하회 구간 안인지. 주말 유출은 다음 영업일로 이월 후 판정한다. */
export function outflowInBreach(date: IsoDate, breaches: BreachWindow[]): boolean {
  return breachWindowFor(date, breaches) !== null;
}

/** 실적 구간 항등식(기초 + 유입 − 유출 = 기말)이 깨진 날만 반환. */
export function checkActualIdentity(full: FullTables): { date: IsoDate; diff: number }[] {
  return full.cashDaily
    .map((r) => ({ date: r.date, diff: r.opening_balance + r.inflow_krw - r.outflow_krw - r.closing_balance }))
    .filter((x) => x.diff !== 0);
}
