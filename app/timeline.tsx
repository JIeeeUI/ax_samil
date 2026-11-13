import { addDays, daysBetween } from '../src/engine/calendar.js';
import type { BreachWindow } from '../src/engine/cash.js';
import type { IsoDate } from '../src/engine/types.js';
import { formal } from './formal.js';
import { koDate } from './plain.js';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const MAX_STACK = 4;

/**
 * 현금 타임라인: 얇은 띠 하나에 현금 부족 구간(띠)과 각 건의 결정 기한(점)을 함께 보여 준다.
 * 아래에 한 줄 요약과 '차이 사유' 펼치기를 둔다. 색은 현금 부족 구간에만 쓴다.
 */
export function CashTimeline({
  today, breaches, deadlines, comparison,
}: {
  today: IsoDate;
  breaches: BreachWindow[];
  deadlines: IsoDate[];
  comparison: { needsFinanceCheck: boolean; lines: string[]; unverified: string[] };
}) {
  const points = [today, ...deadlines, ...breaches.flatMap((b) => [b.start, b.end])].sort();
  const start = points[0];
  const end = addDays(points[points.length - 1], 7);
  const span = Math.max(1, daysBetween(start, end));
  const pos = (d: IsoDate) => `${(Math.min(Math.max(daysBetween(start, d), 0), span) / span) * 100}%`;

  // 같은 날짜의 건은 위로 쌓고, 넘치면 개수로 표시한다.
  const byDate = new Map<IsoDate, number>();
  for (const d of deadlines) byDate.set(d, (byDate.get(d) ?? 0) + 1);

  // 매달 1일 눈금
  const ticks: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (d.endsWith('-01') && d !== start) ticks.push(d);

  const [official, recalc, ...why] = comparison.lines.map(formal);
  const rangeText = breaches.map((b) => `${koDate(b.start)} ~ ${koDate(b.end)}`).join(', ');
  const summaryText = breaches.length > 0
    ? `${breaches.map((b) => `${koDate(b.start)} ~ ${koDate(b.end)}`).join(', ')} 현금 부족 구간입니다. 이 기간에 돈이 나가는 건은 금액과 관계없이 CEO/이사회가 결정합니다.`
    : '현재 가정에서는 현금 부족 구간이 없습니다.';
  const label = `결정 기한 분포: ${[...byDate].map(([d, n]) => `${koDate(d)} ${n}건`).join(', ')}. ${summaryText}`;

  return (
    <section className="tl" aria-label="현금 타임라인">
      <div className="tl-plot" role="img" aria-label={label}>
        <div className="tl-axis" />
        {breaches.map((b) => (
          <div key={b.start} className="tl-band" style={{ left: pos(b.start), width: `calc(${pos(b.end)} - ${pos(b.start)})` }} />
        ))}
        {ticks.map((t) => (
          <span key={t} className="tl-tick" style={{ left: pos(t) }}>{md(t)}</span>
        ))}
        <span className="tl-today" style={{ left: pos(today) }}><i>오늘 {md(today)}</i></span>
        {[...byDate].map(([d, n]) => (
          <span key={d} className="tl-stack" style={{ left: pos(d) }} title={`${koDate(d)} 결정 기한 ${n}건`}>
            {Array.from({ length: Math.min(n, MAX_STACK) }, (_, k) => <i key={k} className="tl-dot" />)}
            {n > MAX_STACK && <b>+{n - MAX_STACK}</b>}
          </span>
        ))}
        {breaches.map((b) => (
          <span key={`l${b.start}`} className="tl-label" style={{ left: pos(b.start) }}>현금 부족 구간 {md(b.start)}–{md(b.end)}</span>
        ))}
      </div>
      <p className="tl-sum">
        {breaches.length > 0 ? (
          <>
            <strong className="accent">{rangeText}</strong> 현금 부족 구간입니다. 이 기간에 돈이 나가는 건은 금액과 관계없이 CEO/이사회가 결정합니다.
          </>
        ) : '현재 가정에서는 현금 부족 구간이 없습니다.'}
        {comparison.needsFinanceCheck && official && recalc && (
          <> 공식 전망 {official.replace(/^재무 공식 전망\s*/, '')}, {recalc}.</>
        )}
      </p>
      {comparison.needsFinanceCheck && (
        <details className="more tl-more">
          <summary>차이 사유</summary>
          <ul className="reasons">
            {why.map((w) => <li key={w}>{w}</li>)}
            {comparison.unverified.map((u) => <li key={u}>{formal(u)}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
