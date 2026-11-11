import type { IsoDate } from '../engine/types.js';

export interface Facts { numbers: number[]; dates: IsoDate[] }
export interface NumberToken { raw: string; values: number[] }

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
/** PLAN-007, CONTRACT-INF-001, D-3 같은 식별자·단계 이름은 숫자로 보지 않는다. */
const ID_RE = /\b[A-Z][A-Za-z]*(?:-[A-Za-z]+)*-\d+\b/g;
const NUM_RE = /(-?\d[\d,]*(?:\.\d+)?)(\s?(?:천만|억|만|천))?(\s?%)?/g;
/** 한글 수사(이십팔억)·월일 표기·조 단위는 대조할 수 없으므로 허용하지 않는다. */
const UNVERIFIABLE_RE = /[일이삼사오육칠팔구]\s?[십백천만억]|\d+\s?월\s?\d+\s?일|\d\s?조|천억/g;
const UNIT: Record<string, number> = { 천만: 1e7, 억: 1e8, 만: 1e4, 천: 1e3 };

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

/** 큰 값은 사실상 정확히 일치해야 한다(28.1억이 28억으로 통과하지 않게). 작은 값(ROAS·비율)은 반올림 오차만 허용한다. */
const close = (a: number, b: number) => Math.abs(a - b) <= (Math.abs(b) >= 1000 ? Math.abs(b) * 1e-6 : 0.005);

/** AI가 쓴 문장 속 숫자·날짜가 모두 엔진 값(facts)과 일치해야 반영한다. */
export function verifyFacts(text: string, facts: Facts): { ok: boolean; unmatched: string[] } {
  const t = extractTokens(text);
  const unmatched = [
    ...(text.match(UNVERIFIABLE_RE) ?? []),
    ...t.dates.filter((d) => !facts.dates.includes(d)),
    ...t.numbers.filter((n) => !n.values.some((v) => facts.numbers.some((f) => close(v, f)))).map((n) => n.raw),
  ];
  return { ok: unmatched.length === 0, unmatched };
}
