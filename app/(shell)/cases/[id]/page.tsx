import Link from 'next/link';
import { summarizeForApproval } from '../../../../src/ai/assist.js';
import { createProvider } from '../../../../src/ai/provider.js';
import { getService } from '../../../../src/app/instance.js';
import { decisionRole, ROLES, ROLE_LABEL } from '../../../../src/workflow/roles.js';
import {
  actClose, actConfirmFinance, actDecide, actPrimary, actProposeChange, actResubmit, actSubmit,
} from '../../../actions.js';
import { ACTION_LABEL, Badge, ESCALATION_LABEL, Flash, pct, routeTone, won } from '../../../components.js';
import { FLOW_STEPS, STATUS_PLAIN, WHO_DECIDES, daysLeftText, flowIndex, issuePlain, koDate, nextStep, shortWon } from '../../../plain.js';
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
  // 1차/2차를 켠 경우 CEO/이사회는 1차 상신 또는 긴급 병행 상신 뒤에만 결정한다.
  const canSecond = !d.review || d.review.state === 'escalated' || d.review.state === 'closed_parallel' || d.review.parallel;
  const step = nextStep(i, role);
  const at = flowIndex(i.status);
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /></>;
  const openReqs = d.requests.filter((q) => q.status === 'requested');
  return (
    <>
      <Flash error={error} />
      <p><Link href="/">← 목록으로</Link></p>
      <ol className="steps" aria-label="진행 단계">
        {FLOW_STEPS.map((s, n) => <li key={s} className={n < at ? 'done' : n === at ? 'now' : ''}>{s}</li>)}
      </ol>

      <h1>{step.text}<small>{i.influencer} · {i.kind === 'contract' ? '연간 전속계약 갱신' : '캠페인 확대 요청'} ({id})</small></h1>

      {step.kind === 'mine' && (
        <div className="cta">
          {i.status === 'finance_review' && role === 'finance' && <form action={actConfirmFinance}>{hidden}<button type="submit">재무 확인 완료</button></form>}
          {i.status === 'routed' && (role === 'marketing' || role === 'finance') && <form action={actSubmit}>{hidden}<button type="submit">{WHO_DECIDES[i.routeLevel]}에게 올리기</button></form>}
          {i.status === 'submitted' && role === decider && canSecond && (
            <div className="two">
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="approve" /><button type="submit">승인</button></form>
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="reject" /><button type="submit" className="danger">거절</button></form>
            </div>
          )}
          {i.status === 'rejected' && (role === 'marketing' || role === 'finance') && (
            <div className="two"><form action={actResubmit}>{hidden}<button type="submit">다시 올리기</button></form><form action={actClose}>{hidden}<button type="submit" className="secondary">종결</button></form></div>
          )}
        </div>
      )}
      {i.status === 'submitted' && role === decider && canSecond && (
        <details className="fold"><summary>정보가 더 필요하면 보류하기</summary>
          <form action={actDecide} className="hold">{hidden}<input type="hidden" name="decision" value="hold" />
            <label>무엇을 확인해야 하나요? <input name="holdNeeded" defaultValue={d.needsInfo[0] ?? ''} required /></label>
            <label>누가 확인하나요? <select name="holdOwner" defaultValue="finance">{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
            <label>언제까지 답을 받나요? <input type="date" name="holdDue" required /></label>
            <button type="submit" className="secondary">보류하고 확인 요청 보내기</button>
          </form>
        </details>
      )}
      {i.status === 'on_hold' && <p><Link href="/requests">확인 요청</Link>에서 답변을 입력하면 자동으로 다시 계산해요.</p>}
      {step.kind === 'waiting' && i.status !== 'on_hold' && <p className="meta">위쪽 “보는 사람”을 바꾸면 그 역할로 이어서 해 볼 수 있어요(시연용).</p>}

      {d.review && (
        <section className="card-block">
          <h2>결재 단계 <small>(1차 대표 검토 → 2차 CEO/이사회 결정 · 교육용 가정)</small></h2>
          <ol className="plain">
            <li><strong>1차 대표 검토</strong>: {{
              pending: '검토 대기', held: `보류 중(담당 답변 기한 ${d.review.holdDue})`, escalated: '상신 완료 → 2차로 올렸어요',
              returned: '반려(거절과 같아요, 다시 올릴 수 있어요)', closed_parallel: '병행 결정으로 닫힘(CEO가 먼저 결정했어요)',
            }[d.review.state]}{d.review.parallel && d.review.state !== 'closed_parallel' && <> <Badge tone="red">1차 미결</Badge></>}</li>
            <li><strong>2차 CEO/이사회 결정</strong>: {i.status === 'approved' ? '승인' : i.status === 'rejected' ? '거절' : d.review.parallel
              ? `긴급이라 병행 상신했어요(${d.review.parallelDate}, 결정 기한 ${d.review.urgentDays}일 이내)` : d.review.state === 'escalated' ? '결정 요청됨' : '1차 상신 후 결정해요'}</li>
          </ol>
          <p className="meta">1차에서 보류해도 시계는 멈추지 않아요. 보류 기한은 {koDate(d.review.holdCapDate)}까지만 가능하고, 결정 기한 {d.review.urgentDays}일 전부터는 1차가 끝나지 않아도 CEO/이사회에 함께 올려요.</p>
          {i.status === 'submitted' && role === 'masil_ceo' && (d.review.state === 'pending' || d.review.state === 'held') && (
            <>
              <div className="two">
                <form action={actPrimary}>{hidden}<input type="hidden" name="op" value="escalate" /><button type="submit">검토 마치고 CEO/이사회에 올리기</button></form>
                <form action={actPrimary}>{hidden}<input type="hidden" name="op" value="return" /><button type="submit" className="danger">반려</button></form>
              </div>
              {d.review.state === 'pending' && (d.review.canHold ? (
                <details className="fold"><summary>정보가 더 필요하면 1차 보류</summary>
                  <form action={actPrimary} className="hold">{hidden}<input type="hidden" name="op" value="hold" />
                    <label>무엇을 확인해야 하나요? <input name="holdNeeded" defaultValue={d.needsInfo[0] ?? ''} required /></label>
                    <label>누가 확인하나요? <select name="holdOwner" defaultValue="finance">{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
                    <label>언제까지 답을 받나요? (최대 {d.review.holdCapDate}) <input type="date" name="holdDue" max={d.review.holdCapDate} required /></label>
                    <button type="submit" className="secondary">보류하고 확인 요청 보내기</button>
                  </form>
                </details>
              ) : <p className="meta">보류 상한일({d.review.holdCapDate})이 지나 1차 보류는 만들 수 없어요. 바로 CEO/이사회에 올리세요.</p>)}
            </>
          )}
          {i.status === 'submitted' && role === decider && !canSecond && <p>아직 1차 대표 검토 중이라 결정할 수 없어요. 긴급해지면 자동으로 함께 올라옵니다.</p>}
        </section>
      )}

      <section className="summary">
        <ul className="facts">
          <li><span className="k">금액</span><span className="v">{shortWon(i.amount)}<small>{i.scale === '풀스케일' ? '1년치 고정 비용' : '캠페인 한 건'} · {won(i.amount)}</small></span></li>
          <li><span className="k">결정하는 사람</span><span className="v"><Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}{i.provisional ? ' (잠정)' : ''}</Badge>
            {i.boardDate && <small>기한 전 이사회 {koDate(i.boardDate)}</small>}</span></li>
          <li><span className="k">결정 기한</span><span className="v">{koDate(i.effectiveDeadline)}<small>{daysLeftText(i.daysLeft)}</small></span></li>
          <li><span className="k">확인할 점</span>
            <span className="v">{i.issues.length === 0 ? '없어요' : (
              <ul className="plain">{i.issues.map((c) => <li key={c}>{issuePlain(c).serious ? '⚠ ' : ''}{issuePlain(c).text}</li>)}</ul>
            )}</span></li>
        </ul>
        {i.provisional && <p className="meta">잠정 판정이에요. 성과 피 조건이 확인되면 결정하는 사람이 바뀔 수 있어요.</p>}
        {i.settlementDate !== '' && i.settlementDate < i.deadline && <p className="meta">계약 확정일은 {koDate(i.deadline)}이지만, 돈이 먼저 나가는 날({koDate(i.settlementDate)})이 있어 그 전에 결정해야 해요.</p>}
      </section>

      {d.escalation && (
        <div className="flash flash-error">
          <strong>기한이 코앞이에요.</strong> 결정 없이 {koDate(i.effectiveDeadline)}이 지나면 그대로 확정(또는 집행)돼요. 선택지: {d.escalation.map((o) => ESCALATION_LABEL[o]).join(' · ')}
        </div>
      )}
      {d.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">⚠ {w.message}</div>)}
      {openReqs.length > 0 && <div className="flash flash-ok">답을 기다리는 확인 요청 {openReqs.length}건 — {openReqs.map((q) => `${ROLE_LABEL[q.ownerRole as keyof typeof ROLE_LABEL] ?? q.ownerRole}이(가) ${koDate(q.dueDate)}까지`).join(', ')}</div>}

      <details className="fold"><summary>계산 근거 자세히 보기</summary>
        <div className="grid">
          <div><h3>과거 실제 성과</h3><dl>
            <dt>매출 대비 효과 (명목 ROAS)</dt><dd>{r.과거명목ROAS}</dd>
            <dt>비용을 모두 뺀 효과 (실질 ROAS)</dt><dd>{r.과거실질ROAS} <small>0보다 작으면 광고비를 빼고 손해예요</small></dd>
            <dt>반품률 / 업계 기준</dt><dd>{pct(r.반품률)} / {pct(r.채널기준반품률)}</dd>
            <dt>성과 순위 (매출 기준 → 비용 반영)</dt><dd>{r.명목순위 || '-'} → {r.실질순위 || '-'}</dd></dl></div>
          <div><h3>예산 배분</h3><dl><dt>이번 요청 비중</dt><dd>{pct(r.요청비중)}</dd><dt>지금까지 집행 비중</dt><dd>{pct(r.기존집행비중)}</dd></dl></div>
          <div><h3>현금·승인</h3><dl>
            <dt>현금이 부족해질 기간</dt><dd>{r.하회구간}</dd>
            <dt>돈이 나가는 날이 그 기간 안인가요</dt><dd>{r.하회구간해당}</dd>
            <dt>판정 근거</dt><dd>{d.reasons.join(' / ')}</dd></dl></div>
          <div><h3>같은 인플루언서의 다른 건</h3>
            <p>{d.group.map((g) => <span key={g.id}><Link href={`/cases/${g.id}`}>{g.id}</Link> ({STATUS_PLAIN[g.status]}) </span>)}</p>
            {d.penalty !== null && <p>갱신 직후 해지하면 위약금 <strong>{shortWon(d.penalty)}</strong> <small>(가정: 남은 고정 비용의 50%)</small></p>}
            {d.notes.map((n) => <p key={n} className="meta">{n}</p>)}</div>
        </div>
        {r.기안예상GMV !== '' && <p className="meta">요청서의 예상 매출 {won(r.기안예상GMV)}은 쿠폰·반품·광고비를 빼기 전 숫자라 이것만으로는 승인 근거가 되지 않아요.</p>}
      </details>

      <details className="fold"><summary>결재자용 요약 문장 {summary.source === 'ai' ? '(AI 작성)' : '(자동 작성)'}</summary>
        <p>{summary.text}</p>
        {summary.note && <p className="meta">{summary.note}</p>}
        <p><Link href={`${back}?ai=1`}>AI로 다시 쓰기</Link> <small>AI 키가 없으면 자동 작성 문장으로 대체돼요. AI는 승인·거절을 정하지 않아요.</small></p>
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
        <details className="fold"><summary>시연: 고정 비용을 낮추자고 한다면?</summary>
          <form action={actProposeChange} className="hold">{hidden}
            <label>1년 고정 비용(원) <input name="fee" inputMode="numeric" placeholder="1800000000" required /></label>
            <label>돈이 나가는 날(알고 있다면) <input type="date" name="cashOutflowDate" /></label>
            <button type="submit" className="secondary">이 조건으로 다시 계산하기</button>
          </form>
          <p className="meta">시연용 입력이에요. 금액에 따라 결정하는 사람이 바뀌는지 볼 수 있어요 (예: 18억 원, 9억 원).</p>
        </details>
      )}
    </>
  );
}
