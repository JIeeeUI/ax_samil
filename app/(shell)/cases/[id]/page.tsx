import Link from 'next/link';
import { summarizeForApproval } from '../../../../src/ai/assist.js';
import { createProvider } from '../../../../src/ai/provider.js';
import { getService } from '../../../../src/app/instance.js';
import { decisionRole, ROLES, ROLE_LABEL } from '../../../../src/workflow/roles.js';
import {
  actClose, actConfirmFinance, actDecide, actProposeChange, actResubmit, actSubmit,
} from '../../../actions.js';
import { ACTION_LABEL, Badge, ESCALATION_LABEL, Flash, pct, routeTone, won } from '../../../components.js';
import { STATUS_PLAIN, WHO_DECIDES, daysLeftText, issuePlain, nextStep } from '../../../plain.js';
import { currentRole } from '../../../session.js';

export const dynamic = 'force-dynamic';

export default async function CasePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ai?: string }> }) {
  const { id } = await params;
  const { error, ai } = await searchParams;
  const svc = await getService();
  const [d, role] = [await svc.getCase(id), await currentRole()];
  const i = d.item;
  const r = d.row;
  const back = `/cases/${id}`;
  const summary = await summarizeForApproval(d, ai === '1' ? createProvider(process.env) : null);
  const decider = decisionRole(i.routeLevel);
  const step = nextStep(i, role);
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /></>;
  const openReqs = d.requests.filter((q) => q.status === 'requested');
  return (
    <>
      <Flash error={error} />
      <p><Link href="/">← 오늘 할 일로 돌아가기</Link></p>
      <h1>{i.influencer} <small>{i.id} · {i.kind === 'contract' ? '연간 전속계약 갱신' : '캠페인 확대 요청'}</small></h1>
      <p><Badge tone={step.kind === 'mine' ? 'blue' : 'gray'}>{STATUS_PLAIN[i.status]}</Badge></p>

      <section className="summary">
        <h2>한눈에 보기</h2>
        <dl>
          <dt>요청 금액</dt>
          <dd>{won(i.amount)} <small>{i.scale === '풀스케일' ? '(1년치 고정 비용 · 회사 실제 규모)' : '(캠페인 한 건)'}</small></dd>
          <dt>누가 결정하나요</dt>
          <dd><Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}</Badge>{i.provisional && <Badge tone="amber">잠정</Badge>} <small>{d.reasons[0]}</small>
            {i.boardDate && <div>기한 전에 열리는 이사회: {i.boardDate}</div>}</dd>
          <dt>언제까지 결정해야 하나요</dt>
          <dd><strong>{i.effectiveDeadline}</strong> ({daysLeftText(i.daysLeft)})
            {i.settlementDate !== '' && i.settlementDate < i.deadline && <div><small>계약 확정일은 {i.deadline}이지만, 돈이 먼저 나가는 날이 {i.settlementDate}이라 이 날까지 결정해야 해요.</small></div>}</dd>
          <dt>확인할 점</dt>
          <dd>{i.issues.length === 0 ? '특이사항 없음' : (
            <ul className="plain">{i.issues.map((c) => <li key={c}><Badge tone={issuePlain(c).serious ? 'red' : 'amber'}>{issuePlain(c).serious ? '주의' : '참고'}</Badge> {issuePlain(c).text}</li>)}</ul>
          )}</dd>
        </dl>
        {d.escalation && (
          <div className="flash flash-error">
            <strong>기한이 곧 다가옵니다.</strong> 결정 없이 {i.effectiveDeadline}이 지나면 그대로 확정(또는 집행)돼요. 방법은 세 가지: {d.escalation.map((o) => ESCALATION_LABEL[o]).join(' · ')}
          </div>
        )}
        {d.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">⚠ {w.message}</div>)}
      </section>

      <section className="todo">
        <h2>지금 할 일 <small>(현재 역할: {ROLE_LABEL[role]})</small></h2>
        <p className="big">{step.kind === 'mine' ? '👉 ' : ''}{step.text}</p>
        {i.status === 'finance_review' && role === 'finance' && <form action={actConfirmFinance}>{hidden}<button type="submit">재무 확인 완료</button></form>}
        {i.status === 'routed' && (role === 'marketing' || role === 'finance') && <form action={actSubmit}>{hidden}<button type="submit">{WHO_DECIDES[i.routeLevel]}에게 올리기</button></form>}
        {i.status === 'submitted' && role === decider && (
          <>
            <div className="actions">
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="approve" /><button type="submit">승인</button></form>
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="reject" /><button type="submit" className="secondary">거절</button></form>
            </div>
            <details className="fold"><summary>정보가 더 필요하면 보류하기</summary>
              <form action={actDecide} className="hold">{hidden}<input type="hidden" name="decision" value="hold" />
                <label>무엇을 확인해야 하나요 <input name="holdNeeded" defaultValue={d.needsInfo[0] ?? ''} required /></label>
                <label>누가 확인하나요 <select name="holdOwner" defaultValue="finance">{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
                <label>언제까지 답을 받나요 <input type="date" name="holdDue" required /></label>
                <button type="submit">보류하고 확인 요청 보내기</button>
              </form>
            </details>
          </>
        )}
        {i.status === 'rejected' && (role === 'marketing' || role === 'finance') && (
          <div className="actions"><form action={actResubmit}>{hidden}<button type="submit">다시 올리기</button></form><form action={actClose}>{hidden}<button type="submit" className="secondary">종결</button></form></div>
        )}
        {i.status === 'on_hold' && <p><Link href="/requests">확인 요청 화면</Link>에서 회신을 입력하면 자동으로 다시 계산해요.</p>}
        {step.kind === 'waiting' && i.status !== 'on_hold' && <p className="meta">위쪽에서 역할을 바꾸면 그 역할로 이어서 진행해 볼 수 있어요(시연용).</p>}
        {openReqs.length > 0 && <p>답을 기다리는 확인 요청: {openReqs.map((q) => `${q.needed}(${ROLE_LABEL[q.ownerRole as keyof typeof ROLE_LABEL] ?? q.ownerRole}, ${q.dueDate}까지)`).join(' / ')}</p>}
      </section>

      <details className="fold"><summary>계산 근거 자세히 보기</summary>
        <div className="grid">
          <div><h3>과거 실제 성과</h3><dl>
            <dt>매출 대비 효과(명목 ROAS)</dt><dd>{r.과거명목ROAS}</dd>
            <dt>비용을 모두 뺀 효과(실질 ROAS)</dt><dd>{r.과거실질ROAS} <small>0보다 작으면 광고비를 빼고 손해라는 뜻</small></dd>
            <dt>반품률 / 업계 기준</dt><dd>{pct(r.반품률)} / {pct(r.채널기준반품률)}</dd>
            <dt>성과 순위(매출 기준 → 비용 반영)</dt><dd>{r.명목순위 || '-'} → {r.실질순위 || '-'}</dd></dl></div>
          <div><h3>예산 배분</h3><dl><dt>이번 요청 비중</dt><dd>{pct(r.요청비중)}</dd><dt>지금까지 집행 비중</dt><dd>{pct(r.기존집행비중)}</dd></dl></div>
          <div><h3>현금·승인</h3><dl>
            <dt>현금이 부족해질 기간</dt><dd>{r.하회구간}</dd>
            <dt>돈이 나가는 날이 그 기간 안인가요</dt><dd>{r.하회구간해당}</dd>
            <dt>판정 근거</dt><dd>{d.reasons.join(' / ')}</dd></dl></div>
          <div><h3>같은 인플루언서의 다른 건</h3>
            <p>{d.group.map((g) => <span key={g.id}><Link href={`/cases/${g.id}`}>{g.id}</Link> ({STATUS_PLAIN[g.status]}) </span>)}</p>
            {d.penalty !== null && <p>계약을 갱신한 직후 해지하면 위약금 <strong>{won(d.penalty)}</strong> <small>(가정: 남은 고정 비용의 50%)</small></p>}
            {d.notes.map((n) => <p key={n} className="meta">{n}</p>)}</div>
        </div>
        {r.기안예상GMV !== '' && <p className="meta">요청서가 말하는 예상 매출 {won(r.기안예상GMV)}은 쿠폰·반품·광고비를 빼기 전 숫자라서, 이것만으로는 승인 근거가 되지 않아요.</p>}
      </details>

      <details className="fold"><summary>결재자용 요약 문장 {summary.source === 'ai' ? '(AI 작성)' : '(자동 작성)'}</summary>
        <p>{summary.text}</p>
        {summary.note && <p className="meta">{summary.note}</p>}
        <p><Link href={`${back}?ai=1`}>AI로 다시 쓰기</Link> <small>AI 키가 없으면 자동 작성 문장으로 대체돼요. AI는 승인·거절을 정하지 않습니다.</small></p>
      </details>

      <details className="fold"><summary>처리 기록 {d.events.length}건</summary>
        <table><thead><tr><th>날짜</th><th>누가</th><th>무엇을</th></tr></thead>
          <tbody>{d.events.map((e) => (
            <tr key={e.id}>
              <td>{e.business_date}</td>
              <td>{e.actor_role === 'system' ? '시스템' : ROLE_LABEL[e.actor_role as keyof typeof ROLE_LABEL] ?? e.actor_role}{e.simulated && <Badge tone="blue">시연</Badge>}</td>
              <td>{ACTION_LABEL[e.action] ?? e.action}</td>
            </tr>
          ))}</tbody></table>
      </details>

      {i.kind === 'contract' && !['approved', 'closed', 'overdue'].includes(i.status) && (
        <details className="fold"><summary>시연: 에이전시가 고정 비용을 낮추자고 제안한다면?</summary>
          <form action={actProposeChange} className="hold">{hidden}
            <label>1년 고정 비용(원) <input name="fee" inputMode="numeric" placeholder="1800000000" required /></label>
            <label>돈이 나가는 날(알고 있다면) <input type="date" name="cashOutflowDate" /></label>
            <button type="submit">이 조건으로 다시 계산하기</button>
          </form>
          <p className="meta">시연용 입력입니다. 금액에 따라 결정하는 사람이 바뀌는지 볼 수 있어요(예: 18억 원, 9억 원).</p>
        </details>
      )}
    </>
  );
}
