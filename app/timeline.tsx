import Link from 'next/link';
import { addDays, daysBetween } from '../src/engine/calendar.js';
import type { BreachWindow } from '../src/engine/cash.js';
import type { IsoDate } from '../src/engine/types.js';
import { formal } from './formal.js';
import { koDate, shortWon } from './plain.js';

export interface TimelineItem {
  id: string;
  name: string; // 제안명(인플루언서)
  kind: string; // 유형
  amount: number;
  scale: '표본' | '풀스케일';
  deadline: IsoDate; // 결정 기한
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const GROUP_FROM = 4; // 같은 날짜가 이 건수 이상이면 '○건' 배지로 묶는다
const MIN_DOT = 8;
const MAX_DOT = 16;

const isMonday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
const inBand = (d: IsoDate, bs: BreachWindow[]) => bs.some((b) => d >= b.start && d <= b.end);

/**
 * 현금 타임라인: 얇은 띠 하나에 현금 부족 구간(연한 빨강 띠)과 각 건의 결정 기한(점)을 함께 보여 준다.
 * 점 하나 = 건 하나(금액이 크면 점이 큼, 마우스를 올리면 제안명·금액·결정 기한), 구간 안의 점만 포인트색.
 * 같은 날짜가 많으면 '○건' 배지로 묶는다. 공식 전망과 재계산의 차이는 '차이 사유' 펼침 안에 둔다.
 */
export function CashTimeline({
  today, breaches, items, comparison,
}: {
  today: IsoDate;
  breaches: BreachWindow[];
  items: TimelineItem[];
  comparison: { needsFinanceCheck: boolean; lines: string[]; unverified: string[] };
}) {
  const days = [today, ...items.map((i) => i.deadline), ...breaches.flatMap((b) => [b.start, b.end])].sort();
  const start = days[0];
  const end = addDays(days[days.length - 1], 7);
  const span = Math.max(1, daysBetween(start, end));
  const ratio = (d: IsoDate) => Math.min(Math.max(daysBetween(start, d), 0), span) / span;
  const pos = (d: IsoDate) => `${ratio(d) * 100}%`;
  const tipSide = (d: IsoDate) => (ratio(d) < 0.15 ? 'tip-l' : ratio(d) > 0.85 ? 'tip-r' : '');

  // 주 단위 눈금(월요일)
  const ticks: IsoDate[] = [];
  let first = start;
  while (!isMonday(first)) first = addDays(first, 1);
  for (let d = first; d <= end; d = addDays(d, 7)) ticks.push(d);

  // 점 크기: 같은 규모(표본) 안에서만 금액 순서로 정한다. 풀스케일(연간 계약)은 표본과 비교하지 않고 속이 빈 큰 점으로 표시한다.
  const sample = items.filter((i) => i.scale === '표본').map((i) => i.amount);
  const lo = Math.min(...sample, Infinity);
  const hi = Math.max(...sample, -Infinity);
  const sizeOf = (i: TimelineItem) => (i.scale === '풀스케일' ? MAX_DOT : hi > lo ? Math.round(MIN_DOT + ((i.amount - lo) / (hi - lo)) * (MAX_DOT - MIN_DOT - 4)) : 10);
  const tipOf = (i: TimelineItem) => `${i.name} ${i.kind} · ${shortWon(i.amount)} · 결정 기한 ${koDate(i.deadline)}`;

  const byDate = new Map<IsoDate, TimelineItem[]>();
  for (const i of [...items].sort((a, b) => b.amount - a.amount)) byDate.set(i.deadline, [...(byDate.get(i.deadline) ?? []), i]);

  const [official, recalc, ...why] = comparison.lines.map(formal);
  const rangeText = breaches.map((b) => `${koDate(b.start)} ~ ${koDate(b.end)}`).join(', ');
  const label = `결정 기한 ${items.length}건: ${[...byDate].map(([d, g]) => `${koDate(d)} ${g.length}건`).join(', ')}.${breaches.length > 0 ? ` 현금 부족 구간 ${rangeText}.` : ''}`;

  return (
    <section className="tl" aria-label="현금 타임라인">
      <div className="tl-plot" role="group" aria-label={label}>
        <div className="tl-axis" />
        {breaches.map((b) => (
          <div key={b.start} className="tl-band" style={{ left: pos(b.start), width: `calc(${pos(b.end)} - ${pos(b.start)})` }} />
        ))}
        {breaches.map((b) => (
          <span key={`l${b.start}`} className="tl-label" style={{ left: pos(b.start) }}>현금 부족 구간 {md(b.start)}–{md(b.end)}</span>
        ))}
        {breaches.flatMap((b) => [
          <span key={`s${b.start}`} className="tl-edge" style={{ left: pos(b.start) }}><i>{md(b.start)} 시작</i></span>,
          <span key={`e${b.end}`} className="tl-edge" style={{ left: pos(b.end) }}><i>{md(b.end)} 끝</i></span>,
        ])}
        {ticks.map((t, n) => (
          <span key={t} className={`tl-tick${n % 2 ? ' alt' : ''}`} style={{ left: pos(t) }}><i>{md(t)}</i></span>
        ))}
        <span className="tl-today" style={{ left: pos(today) }}><i>오늘 {md(today)}</i></span>

        {[...byDate].map(([d, group]) => {
          const red = inBand(d, breaches);
          if (group.length >= GROUP_FROM) {
            const tip = [`${koDate(d)} 결정 기한 ${group.length}건`, ...group.map((i) => `${i.name} ${i.kind} · ${shortWon(i.amount)}`)].join('\n');
            return (
              <span key={d} className={`tl-group ${tipSide(d)}${red ? ' red' : ''}`} style={{ left: pos(d) }} tabIndex={0} data-tip={tip} aria-label={tip.replace(/\n/g, ', ')}>
                {group.length}건
              </span>
            );
          }
          // 같은 날짜가 적으면 세로로 쌓지 않고 가로로 살짝 비켜 놓는다.
          return group.map((i, k) => {
            const size = sizeOf(i);
            const offset = (k - (group.length - 1) / 2) * 14;
            return (
              <Link
                key={i.id}
                href={`/cases/${i.id}`}
                className={`tl-dot ${tipSide(d)}${red ? ' red' : ''}${i.scale === '풀스케일' ? ' hollow' : ''}`}
                style={{ left: `calc(${pos(d)} + ${offset}px)`, width: size, height: size }}
                data-tip={tipOf(i)}
                aria-label={tipOf(i)}
              />
            );
          });
        })}
      </div>

      <div className="tl-sum">
        {breaches.length > 0 ? (
          <><strong className="accent">{rangeText}</strong> 현금 부족 구간 — 이 기간에 돈이 나가는 건은 CEO/이사회가 결정합니다.</>
        ) : '현재 가정에서는 현금 부족 구간이 없습니다.'}
        {' '}
        {comparison.needsFinanceCheck && (
          <details className="more tl-more">
            <summary>차이 사유</summary>
            <ul className="reasons">
              {official && <li>{official}</li>}
              {recalc && <li>{recalc}</li>}
              {why.map((w) => <li key={w}>{w}</li>)}
              {comparison.unverified.map((u) => <li key={u}>{formal(u)}</li>)}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
