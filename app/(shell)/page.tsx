import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import type { TodayItem } from '../../src/app/service.js';
import { ROLE_LABEL } from '../../src/workflow/roles.js';
import { Badge, Flash, routeTone } from '../components.js';
import { WHO_DECIDES, daysLeftText, issuePlain, koDate, nextStep, shortWon } from '../plain.js';
import { currentRole } from '../session.js';

export const dynamic = 'force-dynamic';
const SHOW_FIRST = 5;

function CaseRow({ i, mine, hint }: { i: TodayItem; mine: boolean; hint?: string }) {
  const serious = i.issues.filter((c) => issuePlain(c).serious).length;
  return (
    <Link href={`/cases/${i.id}`} className={`row-card${mine ? ' mine' : ''}`}>
      <div className="l">
        <span className="name">{i.influencer} <small>{i.kind === 'contract' ? '연간 계약' : '캠페인'}</small></span>
        <span className="meta2">{koDate(i.effectiveDeadline)}까지 · {daysLeftText(i.daysLeft)}</span>
        <div className="chips">
          <Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}{i.provisional ? ' (잠정)' : ''}</Badge>
          {serious > 0 && <Badge tone="red">주의 {serious}</Badge>}
        </div>
        {hint && <span className="meta2">{hint}</span>}
      </div>
      <div className="r"><div className="amt">{shortWon(i.amount)}</div></div>
      <span className="go" aria-hidden>›</span>
    </Link>
  );
}

export default async function Today({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const svc = await getService();
  const [v, role] = [await svc.listToday(), await currentRole()];
  const steps = v.items.map((i) => ({ i, s: nextStep(i, role) }));
  const mine = steps.filter((x) => x.s.kind === 'mine').map((x) => x.i);
  const waiting = steps.filter((x) => x.s.kind === 'waiting');
  const done = steps.filter((x) => x.s.kind === 'done').map((x) => x.i);
  return (
    <>
      <Flash error={error} />
      <h1>{mine.length > 0 ? `${mine.length}건을 처리해 주세요` : '지금 할 일이 없어요'}<small>{ROLE_LABEL[role]}으로 보고 있어요</small></h1>
      <p className="sub">{mine.length > 0 ? '카드를 눌러 위에서부터 하나씩 처리하면 돼요. 계산은 이미 끝나 있어요.' : '위에서 보는 사람을 바꾸거나, 아래에서 진행 중인 건을 확인해 보세요.'}</p>

      {v.breaches.length > 0 && (
        <div className="flash flash-warn">
          <strong>{v.breaches.map((b) => `${koDate(b.start)} ~ ${koDate(b.end)}`).join(', ')}</strong>에는 회사 현금이 부족해질 수 있어요.
          이 기간에 돈이 나가는 건은 금액이 작아도 CEO/이사회가 결정해요.
        </div>
      )}
      {v.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">⚠ {w.message}</div>)}
      {v.openRequests > 0 && (
        <Link href="/requests" className="row-card"><div className="l"><span className="name">답을 기다리는 확인 요청 {v.openRequests}건</span><span className="meta2">눌러서 답변하기</span></div><span className="go" aria-hidden>›</span></Link>
      )}

      {mine.slice(0, SHOW_FIRST).map((i) => <CaseRow key={i.id} i={i} mine />)}
      {mine.length > SHOW_FIRST && (
        <details className="fold"><summary>나머지 {mine.length - SHOW_FIRST}건 더 보기</summary>
          {mine.slice(SHOW_FIRST).map((i) => <CaseRow key={i.id} i={i} mine />)}</details>
      )}

      {waiting.length > 0 && (
        <details className="fold"><summary>다른 사람을 기다리는 건 {waiting.length}건</summary>
          {waiting.map(({ i, s }) => <CaseRow key={i.id} i={i} mine={false} hint={s.text} />)}</details>
      )}
      {done.length > 0 && (
        <details className="fold"><summary>끝난 건 {done.length}건</summary>
          {done.map((i) => <CaseRow key={i.id} i={i} mine={false} hint={nextStep(i, role).text} />)}</details>
      )}
      <p className="meta">캠페인 요청액(표본 자료)과 연간 계약 금액(회사 실제 규모)은 더하지 않고 따로 봐요.</p>
    </>
  );
}
