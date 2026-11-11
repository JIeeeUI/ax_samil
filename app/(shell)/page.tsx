import Link from 'next/link';
import { getService } from '../../src/app/instance.js';
import type { TodayItem } from '../../src/app/service.js';
import { Badge, Flash, routeTone, won } from '../components.js';
import { WHO_DECIDES, daysLeftText, issuePlain, nextStep } from '../plain.js';
import { currentRole } from '../session.js';

export const dynamic = 'force-dynamic';

function Row({ i, role, showStep }: { i: TodayItem; role: Parameters<typeof nextStep>[1]; showStep: boolean }) {
  const serious = i.issues.filter((c) => issuePlain(c).serious).length;
  return (
    <tr>
      <td><Link href={`/cases/${i.id}`}><strong>{i.influencer}</strong></Link><br /><small>{i.id}</small></td>
      <td className="num">{won(i.amount)}<br /><small>{i.scale === '풀스케일' ? '연간 계약 금액' : '캠페인 요청액'}</small></td>
      <td>{i.effectiveDeadline}<br /><small>{daysLeftText(i.daysLeft)}</small></td>
      <td><Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}</Badge></td>
      <td>{serious > 0 ? <Badge tone="red">주의 {serious}가지</Badge> : <small>특이사항 없음</small>}</td>
      <td>{showStep ? nextStep(i, role).text : null}<br /><Link href={`/cases/${i.id}`}>열어 보기 →</Link></td>
    </tr>
  );
}

function Table({ items, role, showStep }: { items: TodayItem[]; role: Parameters<typeof nextStep>[1]; showStep: boolean }) {
  return (
    <div className="scroll"><table>
      <thead><tr><th>누구 건인가요</th><th>금액</th><th>결정 기한</th><th>누가 결정하나요</th><th>확인할 점</th><th>지금 상태</th></tr></thead>
      <tbody>{items.map((i) => <Row key={i.id} i={i} role={role} showStep={showStep} />)}</tbody>
    </table></div>
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
      <div className="flash flash-ok intro">
        <strong>이 화면이 하는 일</strong>
        <p>인플루언서 광고비를 써도 되는지, <strong>누가 언제까지 승인해야 하는지</strong>를 건마다 자동으로 계산해 보여 줍니다.
          지금은 시연용이라 위쪽에서 역할을 바꿔 가며 눌러 볼 수 있어요. 계산은 이미 끝나 있으니 아래 <strong>“내가 할 일”</strong>만 따라가면 됩니다.</p>
      </div>

      <div className="tiles">
        <div className="tile"><strong>{mine.length}건</strong><span>지금 내가 할 일</span></div>
        <div className="tile"><strong>{soon}건</strong><span>결정 기한이 14일 안</span></div>
        <div className="tile"><strong>{v.openRequests}건</strong><span>답변을 기다리는 확인 요청</span></div>
      </div>

      {v.breaches.length > 0 && (
        <div className="flash flash-warn">
          <strong>현금이 부족해질 수 있는 기간: {v.breaches.map((b) => `${b.start} ~ ${b.end}`).join(', ')}</strong>
          <br />회사가 지켜야 하는 최소 현금(30억 원) 아래로 내려갈 수 있는 기간이에요. 이 기간에 돈이 나가는 건은 금액이 작아도 CEO/이사회 승인이 필요합니다.
        </div>
      )}
      {v.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">⚠ {w.message}</div>)}

      <h2>내가 할 일 <small>{mine.length}건</small></h2>
      {mine.length === 0
        ? <p>지금 이 역할로 할 일이 없습니다. 위쪽에서 다른 역할로 바꿔 보거나, 아래 “기다리는 중”을 확인하세요.</p>
        : <Table items={mine} role={role} showStep />}

      <details className="fold"><summary>다른 사람을 기다리는 건 {waiting.length}건 (눌러서 펼치기)</summary>
        {waiting.length > 0 && <Table items={waiting} role={role} showStep />}</details>
      <details className="fold"><summary>끝난 건 {done.length}건</summary>
        {done.length > 0 && <Table items={done} role={role} showStep />}</details>
      <p className="meta">금액은 두 종류예요. 캠페인 요청액(표본 자료)과 연간 계약 금액(회사 실제 규모)은 서로 더하지 않고 따로만 봅니다.</p>
    </>
  );
}
