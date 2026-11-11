import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import { TERMINAL } from '../../src/workflow/status.js';
import { decisionRole } from '../../src/workflow/roles.js';
import { Badge, Flash, STATUS_LABEL, routeTone, stageTone, won } from '../components.js';
import { currentRole } from '../session.js';

export const dynamic = 'force-dynamic';

export default async function Today({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const svc = await getService();
  const [v, role] = [await svc.listToday(), await currentRole()];
  const open = v.items.filter((i) => !TERMINAL.has(i.status));
  const urgent = open.filter((i) => i.daysLeft <= 14).slice(0, 6);
  return (
    <>
      <Flash error={error} />
      <h1>오늘 결정할 것</h1>
      {v.breaches.length > 0 ? (
        <div className="flash flash-warn">
          <strong>covenant 하회 구간(최소 현금 30억 원 미만):</strong>{' '}
          {v.breaches.map((b) => `${b.start} ~ ${b.end} (영업일 ${b.businessDays}일)`).join(', ')}
          {' '}— 이 구간에 현금이 나가는 약정은 금액과 무관하게 CEO/이사회 상신입니다.
        </div>
      ) : (
        <div className="flash flash-ok">현재 가정에서는 covenant 하회 구간이 없습니다.</div>
      )}
      {v.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">연결 그룹 경고: {w.message}</div>)}

      <h2>기한 카운트다운 <small>(실효 결정 기한 = min(확정기한, 집행 예정일), 달력일)</small></h2>
      <div className="cards">
        {urgent.length === 0 && <p>14일 안에 기한이 오는 미결정 건이 없습니다.</p>}
        {urgent.map((i) => (
          <Link key={i.id} href={`/cases/${i.id}`} className="card">
            <Badge tone={stageTone(i.alertStage)}>{i.alertStage || '여유'}</Badge>
            <strong>{i.id}</strong> {i.influencer}
            <div>실효 기한 {i.effectiveDeadline} · {i.daysLeft >= 0 ? `${i.daysLeft}일 남음` : '경과'}</div>
            <div><Badge tone={routeTone(i.routeLevel)}>{i.routeLabel}</Badge></div>
          </Link>
        ))}
      </div>

      <h2>제안 {v.items.length}건 <small>(실효 기한 오름차순 · 미결정 {open.length}건 · 확인 요청 {v.openRequests}건)</small></h2>
      <div className="scroll">
        <table>
          <thead><tr>
            <th>제안</th><th>인플루언서</th><th>요청액</th><th>실효 기한</th><th>남은 일수</th><th>경로</th><th>하회 구간</th>
            <th>이슈</th><th>명목→실질 순위</th><th>상태</th>
          </tr></thead>
          <tbody>
            {v.items.map((i) => {
              const mine = i.status === 'submitted' && decisionRole(i.routeLevel) === role;
              return (
                <tr key={i.id} className={mine ? 'mine' : ''}>
                  <td><Link href={`/cases/${i.id}`}>{i.id}</Link></td>
                  <td>{i.influencer}</td>
                  <td className="num">{won(i.amount)} <small>({i.scale})</small></td>
                  <td>{i.effectiveDeadline}{i.settlementDate !== '' && i.settlementDate < i.deadline ? <small> (확정 {i.deadline})</small> : null}</td>
                  <td>{i.daysLeft} {i.alertStage && <Badge tone={stageTone(i.alertStage)}>{i.alertStage}</Badge>}</td>
                  <td><Badge tone={routeTone(i.routeLevel)}>{i.routeLabel}</Badge></td>
                  <td>{i.inBreach}</td>
                  <td>{i.issues.map((c) => <Badge key={c} tone={c === 'LOSS' || c === 'ALLOCATION_INVERSION' ? 'red' : 'amber'}>{c}</Badge>)}</td>
                  <td>{i.nominalRank === '' ? '-' : i.nominalRank} → {i.realRank === '' ? '-' : i.realRank}{mine && <Badge tone="blue">내가 결정</Badge>}</td>
                  <td>{STATUS_LABEL[i.status]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta">표본 계열 금액(기안)과 풀스케일 금액(전속계약 28억 원)은 나란히만 표시하며 합산하지 않습니다.</p>
    </>
  );
}
