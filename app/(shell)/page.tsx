import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import type { TodayItem } from '../../src/app/service.js';
import { Flash, won } from '../components.js';
import { formal } from '../formal.js';
import { CHECK_LABEL, STATUS_PLAIN, WHO_DECIDES, WHO_SHORT, daysLeftText, issuePlain, koDate, nextStep, shortWon } from '../plain.js';
import { currentRole } from '../session.js';
import { CashTimeline } from '../timeline.js';

export const dynamic = 'force-dynamic';

type View = 'open' | 'mine' | 'done';
const VIEWS: [View, string][] = [['open', '진행 중'], ['mine', '내 차례'], ['done', '끝난 건']];

const statusText = (i: TodayItem) => (i.checkLabel ? CHECK_LABEL[i.checkLabel] : STATUS_PLAIN[i.status]);

function Row({ i, mine }: { i: TodayItem; mine: boolean }) {
  const serious = i.issues.filter((c) => issuePlain(c).serious).length;
  const kind = i.kind === 'contract' ? '연간 계약' : '캠페인';
  return (
    <tr>
      <td data-label="제안">
        <Link href={`/cases/${i.id}`} className="rowlink" aria-label={`${i.influencer} ${kind} ${shortWon(i.amount)} 상세 열기`}>{i.influencer}</Link>
      </td>
      <td data-label="유형">{kind}</td>
      <td data-label="금액" className="num" title={won(i.amount)}>{shortWon(i.amount)}</td>
      <td data-label="결정 기한">{koDate(i.effectiveDeadline)} <span className="muted">{daysLeftText(i.daysLeft)}</span></td>
      <td data-label="결정자">{WHO_SHORT[i.routeLevel] ?? WHO_DECIDES[i.routeLevel]}{i.provisional ? ' (잠정)' : ''}</td>
      <td data-label="상태">
        {mine && <strong>내 차례 · </strong>}{statusText(i)}
        {serious > 0 && <span className="accent"> · 주의 {serious}</span>}
      </td>
    </tr>
  );
}

export default async function Today({ searchParams }: { searchParams: Promise<{ error?: string; view?: string }> }) {
  const { error, view: viewParam } = await searchParams;
  const view: View = viewParam === 'mine' || viewParam === 'done' ? viewParam : 'open';
  const svc = await getService();
  const [v, role] = [await svc.listToday(), await currentRole()];
  // v.items는 결정 기한이 이른 순으로 정렬되어 온다.
  const rows = v.items.map((i) => ({ i, kind: nextStep(i, role).kind }));
  const count = { open: rows.filter((r) => r.kind !== 'done').length, mine: rows.filter((r) => r.kind === 'mine').length, done: rows.filter((r) => r.kind === 'done').length };
  const shown = rows.filter((r) => (view === 'open' ? r.kind !== 'done' : view === 'mine' ? r.kind === 'mine' : r.kind === 'done'));

  return (
    <>
      <Flash error={error} />
      <CashTimeline
        today={v.today}
        breaches={v.breaches}
        deadlines={v.items.filter((i) => nextStep(i, role).kind !== 'done').map((i) => i.effectiveDeadline)}
        comparison={v.cashComparison}
      />

      <div className="listhead">
        <h1>할 일</h1>
        <nav aria-label="보기 선택" className="views">
          {VIEWS.map(([k, label]) => (
            <Link key={k} href={k === 'open' ? '/' : `/?view=${k}`} aria-current={view === k ? 'true' : undefined} className={view === k ? 'on' : ''}>
              {label} {count[k]}
            </Link>
          ))}
        </nav>
      </div>

      <table className="list">
        <thead>
          <tr><th>제안</th><th>유형</th><th className="num">금액</th><th>결정 기한</th><th>결정자</th><th>상태</th></tr>
        </thead>
        <tbody>
          {shown.map(({ i, kind }) => <Row key={i.id} i={i} mine={kind === 'mine'} />)}
          {shown.length === 0 && <tr className="empty"><td colSpan={6}>해당하는 건이 없습니다.</td></tr>}
        </tbody>
      </table>

      {v.linkWarnings.map((w) => <p key={w.influencerId} className="warnline"><span className="accent">주의</span> {formal(w.message)}</p>)}
      {v.openRequests > 0 && <p className="line"><Link href="/requests">답을 기다리는 확인 요청 {v.openRequests}건</Link></p>}
      <p className="meta">캠페인 요청액(표본 자료)과 연간 계약 금액(회사 실제 규모)은 더하지 않고 따로 봅니다.</p>
    </>
  );
}
