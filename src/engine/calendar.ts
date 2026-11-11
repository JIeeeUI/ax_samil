import type { IsoDate } from './types.js';

const DAY_MS = 86_400_000;
const toUtc = (d: IsoDate): number => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** 달력일 기준 (to − from). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 영업일 = 월~금, 공휴일 없음(원본 공통 기준). */
export function isBusinessDay(d: IsoDate): boolean {
  const wd = new Date(toUtc(d)).getUTCDay();
  return wd !== 0 && wd !== 6;
}

export function nextBusinessDay(d: IsoDate): IsoDate {
  let x = d;
  while (!isBusinessDay(x)) x = addDays(x, 1);
  return x;
}

/** from~to(양 끝 포함) 사이의 영업일. */
export function businessDaysInRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) if (isBusinessDay(x)) out.push(x);
  return out;
}

export function minDate(a: IsoDate, b: IsoDate | null): IsoDate {
  return b !== null && b < a ? b : a;
}
