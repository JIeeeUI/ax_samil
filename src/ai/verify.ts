import type { IsoDate } from '../engine/types.js';

export interface Facts { numbers: number[]; dates: IsoDate[] }
export interface NumberToken { raw: string; values: number[] }

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
/** PLAN-007, CONTRACT-INF-001, D-3 같은 식별자·단계 이름은 숫자로 보지 않는다. */
const ID_RE = /\b[A-Z][A-Za-z]*(?:-[A-Za-z]+)*-\d+\b/g;
const NUM_RE = /(-?\d[\d,]*(?:\.\d+)?)(\s?(?:천만|억|만))?(\s?%)?/g;
const UNIT: Record<string, number> = { 천만: 1e7, 억: 1e8, 만: 1e4 };

/** 문장 속 날짜와 숫자(쉼표·단위·퍼센트 환산)를 뽑는다. */
export function extractTokens(text: string): { numbers: NumberToken[]; dates: IsoDate[] } {
  const dates = text.match(DATE_RE) ?? [];
  const rest = text.replace(DATE_RE, ' ').replace(ID_RE, ' ');
  const numbers: NumberToken[] = [];
  for (const m of rest.matchAll(NUM_RE)) {
    const base = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isNaN(base)) continue;
    const unit = m[2] ? UNIT[m[2].trim()] : 1;
    const v = base * unit;
    numbers.push({ raw: (m[1] + (m[2] ?? '')).trim(), values: m[3] ? [v, v / 100] : [v] });
  }
  return { numbers, dates };
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005, 0.005 * Math.abs(b));

/** AI가 쓴 문장 속 숫자·날짜가 모두 엔진 값(facts)과 일치해야 반영한다. */
export function verifyFacts(text: string, facts: Facts): { ok: boolean; unmatched: string[] } {
  const t = extractTokens(text);
  const unmatched = [
    ...t.dates.filter((d) => !facts.dates.includes(d)),
    ...t.numbers.filter((n) => !n.values.some((v) => facts.numbers.some((f) => close(v, f)))).map((n) => n.raw),
  ];
  return { ok: unmatched.length === 0, unmatched };
}
