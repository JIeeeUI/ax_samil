import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import type { TodayItem } from '../../src/app/service.js';
import { Badge, Flash, routeTone, won } from '../components.js';
import { WHO_DECIDES, daysLeftText, issuePlain, koDate, nextStep } from '../plain.js';
import { currentRole } from '../session.js';

export const dynamic = 'force-dynamic';
const SHOW_FIRST = 5;

function CaseCard({ i, role, mine }: { i: TodayItem; role: Parameters<typeof nextStep>[1]; mine: boolean }) {
  const serious = i.issues.filter((c) => issuePlain(c).serious).length;
  const step = nextStep(i, role);
  return (
    <article className={`case${mine ? ' mine' : ''}`}>
      <div className="case-head">
        <h3>{i.influencer} <small>{i.id}</small></h3>
        <div className="case-amount">{won(i.amount)}</div>
      </div>
      <ul className="facts">
        <li><span>결정 기한</span><strong>{koDate(i.effectiveDeadline)}</strong> ({daysLeftText(i.daysLeft)})</li>
        <li><span>결정하는 사람</span><Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}</Badge>{i.provisional && <Badge tone="amber">잠정</Badge>}</li>
        {serious > 0 && <li><span>확인할 점</span><Badge tone="red">주의 {serious}가지</Badge></li>}
        <li><span>지금</span>{step.text}</li>
      </ul>
      <Link href={`/cases/${i.id}`} className="btn">{mine ? '열어서 처리하기' : '내용 보기'}</Link>
    </article>
  );
}

export default async function Today({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const svc = await getService();
  const [v, role] = [await svc.listToday(), await currentRole()];
  const steps = v.items.map((i) => ({ i, s: nextStep(i, role) }));
  const mine = steps.filter((x) => x.s.kind === 'mine').map((x) => x.i);
  const waiting = steps.filter((x) => x.s.kind === 'waiting').map((x) => x.i);
  const done = steps.filter((x) => x.s.kind === 'done').map((x) => x.i);
  const soon = v.items.filter((i) => nextStep(i, role).kind !== 'done' && i.daysLeft <= 14).length;
  return (
    <>
      <Flash error={error} />
      <h1>오늘 할 일</h1>
      <p className="lead">아래 <strong>“내가 할 일”</strong>을 위에서부터 하나씩 눌러 처리하세요. 계산은 이미 끝나 있습니다.</p>

      <div className="tiles">
        <div className="tile"><strong>{mine.length}건</strong><span>내가 할 일</span></div>
        <div className="tile"><strong>{soon}건</strong><span>기한 14일 이내</span></div>
        <div className="tile"><strong>{v.openRequests}건</strong><span>답변 기다리는 요청</span></div>
      </div>

      {v.breaches.length > 0 && (
        <div className="flash flash-warn">
          <strong>{v.breaches.map((b) => `${koDate(b.start)} ~ ${koDate(b.end)}`).join(', ')}</strong>은 회사 현금이 부족해질 수 있는 기간이에요.
          이 기간에 돈이 나가는 건은 금액과 관계없이 <strong>CEO/이사회 승인</strong>이 필요합니다.
        </div>
      )}
      {v.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">⚠ {w.message}</div>)}

      <h2>내가 할 일 <small>{mine.length}건</small></h2>
      {mine.length === 0 && <p>지금 이 역할로 할 일이 없습니다. 위쪽 “지금 보는 사람”을 바꿔 보세요.</p>}
      {mine.slice(0, SHOW_FIRST).map((i) => <CaseCard key={i.id} i={i} role={role} mine />)}
      {mine.length > SHOW_FIRST && (
        <details className="fold"><summary>나머지 {mine.length - SHOW_FIRST}건 더 보기</summary>
          {mine.slice(SHOW_FIRST).map((i) => <CaseCard key={i.id} i={i} role={role} mine />)}
        </details>
      )}

      {waiting.length > 0 && (
        <details className="fold"><summary>다른 사람을 기다리는 건 {waiting.length}건</summary>
          {waiting.map((i) => <CaseCard key={i.id} i={i} role={role} mine={false} />)}
        </details>
      )}
      {done.length > 0 && (
        <details className="fold"><summary>끝난 건 {done.length}건</summary>
          {done.map((i) => <CaseCard key={i.id} i={i} role={role} mine={false} />)}
        </details>
      )}
    </>
  );
}
