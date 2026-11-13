import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import type { TodayItem } from '../../src/app/service.js';
import { Flash } from '../components.js';
import { formal } from '../formal.js';
import { CHECK_LABEL, CHECK_SHORT, STATUS_PLAIN, STATUS_SHORT, WHO_DECIDES, WHO_SHORT, daysLeftText, koDate, nextStep, shortWon } from '../plain.js';
import { currentRole } from '../session.js';
import { CashTimeline } from '../timeline.js';
import { TodayList } from '../today-list.js';
import type { ListRow } from '../today-list.js';

export const dynamic = 'force-dynamic';

type View = 'open' | 'mine' | 'done';
const VIEWS: [View, string][] = [['open', '진행 중'], ['mine', '내 차례'], ['done', '끝난 건']];

const statusText = (i: TodayItem) => (i.checkLabel ? CHECK_LABEL[i.checkLabel] : STATUS_PLAIN[i.status]);

function toRow(i: TodayItem, mine: boolean): ListRow {
  const kind = i.kind === 'contract' ? '연간 계약' : '캠페인';
  const [m, d] = [Number(i.effectiveDeadline.slice(5, 7)), Number(i.effectiveDeadline.slice(8, 10))];
  const chk = i.checkLabel ? CHECK_SHORT[i.checkLabel] : undefined;
  const top = i.attention.top;
  return {
    id: i.id,
    name: i.influencer,
    kind,
    amountText: shortWon(i.amount),
    deadline: koDate(i.effectiveDeadline),
    daysLeft: daysLeftText(i.daysLeft),
    who: `${WHO_SHORT[i.routeLevel] ?? WHO_DECIDES[i.routeLevel]}${i.provisional ? ' (잠정)' : ''}`,
    status: STATUS_SHORT[i.status] ?? STATUS_PLAIN[i.status],
    check: chk?.text ?? '',
    checkTone: chk?.tone ?? '',
    attnCount: i.attention.count,
    attnTag: top?.tag ?? '',
    attnTier: top?.tier ?? '',
    mine,
    // 화면에 보이지 않는 값(내부 ID, 날짜·금액의 다른 표기, 주의 문구)도 검색에는 걸리게 한다.
    hay: `${mine ? '내 차례' : ''} ${i.id} ${m}/${d} ${m}월${d}일 ${i.effectiveDeadline} ${i.amount / 10000} ${i.amount} ${statusText(i)} ${i.attention.items.map((x) => `${x.tag} ${x.text}`).join(' ')}`,
  };
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
        items={v.items.filter((i) => nextStep(i, role).kind !== 'done').map((i) => ({ id: i.id, name: i.influencer, kind: i.kind === 'contract' ? '연간 계약' : '캠페인', amount: i.amount, scale: i.scale, deadline: i.effectiveDeadline }))}
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

      <TodayList key={view} rows={shown.map(({ i, kind }) => toRow(i, kind === 'mine'))} tabLabel={VIEWS.find(([k]) => k === view)![1]} />

      {v.openRequests > 0 && <p className="line"><Link href="/requests">답을 기다리는 확인 요청 {v.openRequests}건</Link></p>}
      <p className="meta">캠페인 요청액(표본 자료)과 연간 계약 금액(회사 실제 규모)은 더하지 않고 따로 봅니다.</p>
    </>
  );
}
