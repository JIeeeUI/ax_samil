import Link from 'next/link';
import { Suspense } from 'react';
import { getService } from '../../../../src/app/instance.js';
import { TIER_LABEL } from '../../../../src/workflow/attention.js';
import { canChangeContract, defaultOwnerFor } from '../../../../src/workflow/ownership.js';
import { decisionRole, ROLES, ROLE_LABEL } from '../../../../src/workflow/roles.js';
import { RETURN_REASONS, RETURN_REASON_LABEL } from '../../../../src/workflow/schedule.js';
import {
  actClose, actConfirmFinance, actDecide, actFinanceReturn, actPrimary, actProposeChange, actRecordNotice, actResubmit, actRevisionReply, actSendNotice, actSubmit,
} from '../../../actions.js';
import { ACTION_LABEL, Badge, ESCALATION_LABEL, Flash, pct, routeTone, won } from '../../../components.js';
import { CashNote, CheckList } from '../../../check-ui.js';
import { formal } from '../../../formal.js';
import { CHECK_LABEL, FLOW_STEPS, STATUS_PLAIN, neededLabel, WHO_DECIDES, daysLeftText, flowIndex, koDate, nextStep, shortWon } from '../../../plain.js';
import { currentRole } from '../../../session.js';
import { ApproverSummary, SummaryLoading } from './summary.js';

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
  const att = i.attention;
  const decider = decisionRole(i.routeLevel);
  // 1차/2차를 켠 경우 CEO/이사회는 1차 상신 또는 긴급 병행 상신 뒤에만 결정한다.
  const canSecond = !d.review || d.review.state === 'escalated' || d.review.state === 'closed_parallel' || d.review.parallel;
  const step = nextStep(i, role);
  const at = flowIndex(i.status);
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /></>;
  const cfg = await svc.getConfig();
  const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const openReqs = d.requests.filter((q) => q.status === 'requested');
  // 제목 끝의 괄호 설명은 제목에서 떼어 작은 참고 문구로 보여 준다
  const noteMatch = step.text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const stepMain = noteMatch ? noteMatch[1] : step.text;
  const stepNote = noteMatch ? noteMatch[2] : '';
  return (
    <>
      <Flash error={error} />
      <p><Link href="/">← 목록으로</Link></p>
      <ol className="steps" aria-label="진행 단계">
        {FLOW_STEPS.map((s, n) => <li key={s} className={n < at ? 'done' : n === at ? 'now' : ''} aria-current={n === at ? 'step' : undefined}>{s}{n === at ? <span className="sr"> (현재 단계)</span> : null}</li>)}
      </ol>

      <h1>{stepMain}<small>{i.influencer} · {i.kind === 'contract' ? '연간 전속계약 갱신' : '캠페인 확대 요청'}</small></h1>
      {stepNote && <p className="note">※ {stepNote}</p>}

      <div className="cols"><div className="col">

      <section className="card-block">
        <h2>상신 전 점검 {d.check.label && <Badge tone={d.check.label === 'ready' ? 'green' : d.check.label === 'waiting_info' ? 'amber' : d.check.label === 'finance_pending' ? 'blue' : 'gray'}>{CHECK_LABEL[d.check.label]}</Badge>}</h2>
        <CheckList lines={d.check.lines} />
        <p className="meta">점검은 계산·판정까지만 합니다. 상신은 사람이 누르고, 되돌릴 수 없습니다.</p>
      </section>
      {step.kind === 'mine' && (
        <div className="cta">
          {i.status === 'finance_review' && role === 'finance' && <form action={actConfirmFinance}>{hidden}<input name="opinion" placeholder={d.returnState.opinionRequired ? '재무 의견(필수: 반려 없이 상신)' : '재무 의견(선택)'} title={d.returnState.opinionNotice ?? undefined} required={d.returnState.opinionRequired} /><button type="submit">재무 확인 완료</button></form>}
          {i.status === 'routed' && (role === 'marketing' || role === 'finance') && <form action={actSubmit}>{hidden}{d.check.label === 'waiting_info' && <p className="meta">아직 빠진 정보가 있습니다(위 점검 ④). 그래도 상신하면 결재자가 정보 없이 판단하게 됩니다.</p>}<label><input type="checkbox" name="confirm" value="yes" required /> 상신하면 되돌릴 수 없다는 것을 확인했습니다</label><button type="submit">{WHO_DECIDES[i.routeLevel]}에게 올리기</button></form>}
          {i.status === 'submitted' && role === decider && canSecond && (
            <div className="two">
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="approve" /><button type="submit">승인</button></form>
              <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="reject" /><input name="rejectReason" placeholder="거절 사유(필수)" required /><button type="submit" className="danger">거절</button></form>
            </div>
          )}
          {i.status === 'rejected' && role === 'marketing' && (
            <div className="two"><form action={actResubmit}>{hidden}<button type="submit">다시 올리기</button></form><form action={actClose}>{hidden}<button type="submit" className="secondary">종결</button></form></div>
          )}
        </div>
      )}
      {i.status === 'submitted' && role === decider && canSecond && (
        <details className="fold"><summary>정보가 더 필요하면 보류하기</summary>
          <form action={actDecide} className="hold">{hidden}<input type="hidden" name="decision" value="hold" />
            <label>무엇을 확인해야 합니까? <input name="holdNeeded" placeholder="예: 돈이 나가는 날짜" required /></label>
            <label>누가 확인합니까? <select name="holdOwner" defaultValue={defaultOwnerFor(d.needsInfo[0] ?? '')}>{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
            <label>언제까지 답을 받습니까? <input type="date" name="holdDue" required /></label>
            <button type="submit" className="secondary">보류하고 확인 요청 보내기</button>
          </form>
        </details>
      )}
      {!cfg.showExtended && (i.status === 'revision' || i.status === 'consulting' || d.notice?.status === 'open' || d.notice?.status === 'sent') && (
        <div className="flash flash-warn"><strong>확장 기능에서 처리 중</strong> 이 건은 결재 이후 기능(재무 반려·협의·통보 작업)에서 처리하고 있습니다. 이어서 하려면 <Link href="/settings">설정</Link>에서 “확장 기능(결재 이후) 보기”를 켜십시오. 확인 요청은 <Link href="/requests">확인 요청</Link>에서 그대로 답할 수 있습니다.</div>
      )}
      {cfg.showExtended && i.status === 'finance_review' && role === 'finance' && (d.returnState.allowed ? (
        <details className="fold"><summary>문제가 있으면 마케팅에 되돌리기(반려)</summary>
          <form action={actFinanceReturn} className="hold">{hidden}
            <p className="meta">사유를 고르십시오. 엔진 결과에 해당하는 칸은 미리 체크해 두었습니다. 마케팅은 {koDate(d.returnState.dueIfReturnedToday)}까지 답해야 하고, 반려는 한 번만 할 수 있습니다.</p>
            {RETURN_REASONS.filter((k) => cfg.returnReasons[k]).map((k) => (
              <label key={k}><input type="checkbox" name="reasons" value={k} defaultChecked={d.returnHints.includes(k)} /> {RETURN_REASON_LABEL[k]}</label>
            ))}
            <label>기타 사유(기타를 고른 경우 필수) <input name="otherText" /></label>
            <label>재무 의견(필수) <input name="opinion" required /></label>
            <button type="submit" className="secondary">마케팅에 되돌리기</button>
          </form>
        </details>
      ) : <p className="meta">{d.returnState.why}</p>)}
      {d.cashComparison.needsFinanceCheck && <CashNote lines={d.cashComparison.lines} unverified={d.cashComparison.unverified} />}
      {d.noticeWarning && <div className="flash flash-error"><strong>통보 미완료 시 자동 갱신</strong> {d.noticeWarning}</div>}
      {cfg.showExtended && d.notice && d.notice.status !== 'void' && (
        <section className="card-block">
          <h2>에이전시 통보 <small>(발송은 마케팅, 기록은 계약 담당 · 교육용 가정)</small></h2>
          <p>{{ terminate: '해지 통보', change: '조건 변경 통보', renew_confirm: '갱신 확정 기록' }[d.notice.kind]}{d.notice.required ? ' (필수)' : ' (통보 불요: 기록만)'} · 통보 기한 {koDate(d.notice.dueDate)} · <Badge tone={d.notice.status === 'done' ? 'green' : 'amber'}>{{ open: '미완료', sent: '발송됨(기록 대기)', done: '완료', void: '취소' }[d.notice.status]}</Badge></p>
          {d.notice.sentDate && <p className="meta">발송일 {koDate(d.notice.sentDate)}{d.notice.sentDate > d.notice.dueDate ? ' (통보 기한 이후)' : ''} · 모의 입력</p>}
          {d.notice.status === 'done' && <p className="meta">{koDate(d.notice.recordedDate ?? '')} 기록 · 수령 증빙 {d.notice.receiptProof ? '있음' : '없음'} · 모의 입력</p>}
          {d.notice.required && d.notice.status === 'open' && role === 'marketing' && (
            <form action={actSendNotice} className="hold">{hidden}<input type="hidden" name="kind" value={d.notice.kind} />
              <label>발송일 <input type="date" name="sentDate" required /></label>
              <button type="submit">통보 발송했습니다(모의)</button></form>
          )}
          {(d.notice.status === 'sent' || (!d.notice.required && d.notice.status === 'open')) && role === 'contract' && (
            <form action={actRecordNotice} className="hold">{hidden}
              <label>수령 증빙 <select name="receiptProof" defaultValue="no"><option value="yes">있음</option><option value="no">없음</option></select></label>
              <button type="submit">기록 완료(모의)</button></form>
          )}
        </section>
      )}
      {cfg.showExtended && d.adjustments.length > 0 && (
        <div className="flash flash-warn"><strong>마케팅이 조정한 내용</strong>
          <ul className="reqs">{d.adjustments.map((a, n) => (
            <li key={n}>{a.field === 'settlementDate' ? `집행일 ${md(String(a.from))}→${md(String(a.to))} 조정됨` : `요청액 ${shortWon(Number(a.from))}→${shortWon(Number(a.to))} 조정됨`} <small>({koDate(a.date)})</small></li>
          ))}</ul>
        </div>
      )}
      {cfg.showExtended && d.revisions.length > 0 && (
        <section className="card-block">
          <h2>재무 반려(보완 요청)</h2>
          {d.revisions.map((rv) => (
            <div key={rv.id}>
              <p><strong>{koDate(rv.returnDate)} 반려</strong> · 사유: {rv.reasons.map((x) => RETURN_REASON_LABEL[x as keyof typeof RETURN_REASON_LABEL] ?? x).join(', ')}{rv.otherText ? ` (${rv.otherText})` : ''}</p>
              <p>재무 의견: {rv.opinion}</p>
              <p className="meta">{{ open: `회신 기한 ${koDate(rv.dueDate)}`, adjusted: '마케팅이 조정함', kept: '마케팅: 변경 없음(재무 의견을 붙여 상신)', consult: '마케팅: 협의 필요', unanswered: '미응답: 재무 의견을 붙여 결재자에게 자동 전달됨' }[rv.status]}{rv.replyText ? ` · 답변: ${rv.replyText}` : ''}</p>
            </div>
          ))}
          {i.status === 'revision' && role === 'marketing' && (
            <form action={actRevisionReply} className="hold">{hidden}
              <label>어떻게 하시겠습니까?
                <select name="kind" defaultValue={i.kind === 'plan' ? 'adjust' : 'keep'}>
                  {i.kind === 'plan' && <option value="adjust">조정함(집행일·요청액 바꾸기)</option>}
                  <option value="keep">변경 없음(재무 의견을 붙여 상신)</option>
                  <option value="consult">협의 필요</option>
                </select></label>
              <label>바꿀 집행일(조정할 때) <input type="date" name="settlementDate" defaultValue={i.settlementDate || undefined} /></label>
              <label>바꿀 요청액(원, 조정할 때) <input name="amount" inputMode="numeric" placeholder={String(i.amount)} /></label>
              <label>답변(필수) <input name="text" required /></label>
              <button type="submit">답변 보내기</button>
            </form>
          )}
        </section>
      )}
      {d.rejection && <div className="flash flash-warn"><strong>거절 사유</strong>: {d.rejection.reason} <small>({ROLE_LABEL[d.rejection.actor as keyof typeof ROLE_LABEL] ?? d.rejection.actor} · {koDate(d.rejection.date)})</small></div>}
      {i.status === 'on_hold' && <p><Link href="/requests">확인 요청</Link>에서 답변을 입력하면 자동으로 다시 계산합니다.</p>}

      {d.review && (
        <section className="card-block">
          <h2>결재 단계 <small>(1차 대표 검토 → 2차 CEO/이사회 결정)</small></h2>
          <ol className="plain">
            <li><strong>1차 대표 검토</strong>: {{
              pending: '검토 대기', held: `보류 중(담당 답변 기한 ${d.review.holdDue})`, escalated: '상신 완료 → 2차로 올렸습니다',
              returned: '반려(거절과 같습니다, 다시 올릴 수 있습니다)', closed_parallel: '병행 결정으로 닫힘(CEO가 먼저 결정했습니다)',
            }[d.review.state]}{d.review.parallel && d.review.state !== 'closed_parallel' && <> <Badge tone="red">1차 미결</Badge></>}</li>
            <li><strong>2차 CEO/이사회 결정</strong>: {i.status === 'approved' ? '승인' : i.status === 'rejected' ? '거절' : d.review.parallel
              ? `긴급이라 병행 상신했습니다(${d.review.parallelDate}, 결정 기한 ${d.review.urgentDays}일 이내)` : d.review.state === 'escalated' ? '결정 요청됨' : '1차 상신 후 결정합니다'}</li>
          </ol>
          <p className="meta">1차에서 보류해도 시계는 멈추지 않습니다. 보류 기한은 {koDate(d.review.holdCapDate)}까지만 가능하고, 결정 기한 {d.review.urgentDays}일 전부터는 1차가 끝나지 않아도 CEO/이사회에 함께 올려요.</p>
          {i.status === 'submitted' && role === 'masil_ceo' && (d.review.state === 'pending' || d.review.state === 'held') && (
            <>
              <div className="two">
                <form action={actPrimary}>{hidden}<input type="hidden" name="op" value="escalate" /><button type="submit">검토 마치고 CEO/이사회에 올리기</button></form>
                <form action={actPrimary}>{hidden}<input type="hidden" name="op" value="return" /><input name="rejectReason" placeholder="반려 사유(필수)" required /><button type="submit" className="danger">반려</button></form>
              </div>
              {d.review.state === 'pending' && (d.review.canHold ? (
                <details className="fold"><summary>정보가 더 필요하면 1차 보류</summary>
                  <form action={actPrimary} className="hold">{hidden}<input type="hidden" name="op" value="hold" />
                    <label>무엇을 확인해야 합니까? <input name="holdNeeded" placeholder="예: 돈이 나가는 날짜" required /></label>
                    <label>누가 확인합니까? <select name="holdOwner" defaultValue={defaultOwnerFor(d.needsInfo[0] ?? '')}>{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
                    <label>언제까지 답을 받습니까? (최대 {d.review.holdCapDate}) <input type="date" name="holdDue" max={d.review.holdCapDate} required /></label>
                    <button type="submit" className="secondary">보류하고 확인 요청 보내기</button>
                  </form>
                </details>
              ) : <p className="meta">보류 상한일({d.review.holdCapDate})이 지나 1차 보류는 만들 수 없습니다. 바로 CEO/이사회에 올리십시오.</p>)}
            </>
          )}
          {i.status === 'submitted' && role === decider && !canSecond && <p>아직 1차 대표 검토 중이라 결정할 수 없습니다. 긴급해지면 자동으로 함께 올라옵니다.</p>}
        </section>
      )}

      <section className="summary">
        <ul className="facts">
          <li><span className="k">금액</span><span className="v">{shortWon(i.amount)}<small>{i.scale === '풀스케일' ? '1년치 고정 비용' : '캠페인 한 건'} · {won(i.amount)}</small></span></li>
          <li><span className="k">결정하는 사람</span><span className="v"><Badge tone={routeTone(i.routeLevel)}>{WHO_DECIDES[i.routeLevel]}{i.provisional ? ' (잠정)' : ''}</Badge>
            {i.boardDate && <small>기한 전 이사회 {koDate(i.boardDate)}</small>}</span></li>
          <li><span className="k">결정 기한</span><span className="v">{koDate(i.effectiveDeadline)}<small>{daysLeftText(i.daysLeft)}</small></span></li>
          <li><span className="k">주의할 점{att.count > 0 ? ` ${att.count}가지` : ''}</span>
            <span className="v">{att.count === 0 ? '없습니다' : (
              <ul className="attn">{att.items.map((a) => (
                <li key={a.code}>
                  <span className={`tier tier-${a.tier}`} aria-label={`중요도 ${TIER_LABEL[a.tier]}`}>{TIER_LABEL[a.tier]}</span>
                  <div className="attn-body">
                    <span>{a.text}</span>
                    {a.details.length > 0 && (
                      <details className="more"><summary>상세</summary>{a.details.map((x) => <p key={x}>{formal(x)}</p>)}</details>
                    )}
                  </div>
                </li>
              ))}</ul>
            )}</span></li>
        </ul>
        {att.count > 0 && <p className="meta">중요도: 상 → 중 → 하 순서로 보여 줍니다. 같은 뜻의 경고는 한 줄로 묶었습니다.</p>}
        {i.settlementDate !== '' && i.settlementDate < i.deadline && <p className="meta">계약 확정일은 {koDate(i.deadline)}이지만, 돈이 먼저 나가는 날({koDate(i.settlementDate)})이 있어 그 전에 결정해야 합니다.</p>}
      </section>

      {d.escalation && (
        <div className="flash flash-error">
          <strong>기한이 코앞입니다.</strong> 결정 없이 {koDate(i.effectiveDeadline)}이 지나면 그대로 확정(또는 집행)됩니다. 선택지: {d.escalation.map((o) => ESCALATION_LABEL[o]).join(' · ')}
        </div>
      )}
      {openReqs.length > 0 && (
        <div className="flash flash-ok">
          <strong>답을 기다리는 확인 요청 {openReqs.length}건</strong>
          <ul className="reqs">{openReqs.map((q) => <li key={q.id}>{neededLabel(q.needed)} <small>({ROLE_LABEL[q.ownerRole as keyof typeof ROLE_LABEL] ?? q.ownerRole} · {koDate(q.dueDate)}까지)</small></li>)}</ul>
        </div>
      )}

      </div><div className="col">
      <details className="fold"><summary>계산 근거 자세히 보기</summary>
        <div className="grid">
          <div><h3>과거 실제 성과</h3><dl>
            <dt>매출 대비 효과 (명목 ROAS)</dt><dd>{r.과거명목ROAS}</dd>
            <dt>비용을 모두 뺀 효과 (실질 ROAS)</dt><dd>{r.과거실질ROAS} <small>0보다 작으면 광고비를 빼고 손해입니다</small></dd>
            <dt>반품률 / 업계 기준</dt><dd>{pct(r.반품률)} / {pct(r.채널기준반품률)}</dd>
            <dt>성과 순위 (매출 기준 → 비용 반영)</dt><dd>{r.명목순위 || '-'} → {r.실질순위 || '-'}</dd></dl></div>
          <div><h3>예산 배분</h3><dl><dt>이번 요청 비중</dt><dd>{pct(r.요청비중)}</dd><dt>지금까지 집행 비중</dt><dd>{pct(r.기존집행비중)}</dd></dl></div>
          <div><h3>현금·승인</h3><dl>
            <dt>현금이 부족해질 기간</dt><dd>{r.하회구간}</dd>
            <dt>돈이 나가는 날이 그 기간 안입니까</dt><dd>{r.하회구간해당}</dd>
            <dt>판정 근거</dt><dd>{formal(d.reasons.join(' / '))}</dd></dl></div>
          <div><h3>같은 인플루언서의 다른 건</h3>
            <ul className="linklist">{d.group.map((g) => <li key={g.id}><Link href={`/cases/${g.id}`}>{g.id}</Link><small>{STATUS_PLAIN[g.status]}</small></li>)}</ul>
            {d.penalty !== null && <p>갱신 직후 해지하면 위약금 <strong>{shortWon(d.penalty)}</strong> <small>(가정: 남은 고정 비용의 50%)</small></p>}
            {d.notes.map((n) => <p key={n} className="meta">{formal(n)}</p>)}</div>
        </div>
        {r.기안예상GMV !== '' && <p className="meta">요청서의 예상 매출 {won(r.기안예상GMV)}은 쿠폰·반품·광고비를 빼기 전 숫자라 이것만으로는 승인 근거가 되지 않습니다.</p>}
      </details>

      <Suspense key={ai === '1' ? 'ai' : 'basic'} fallback={<SummaryLoading />}>
        <ApproverSummary d={d} back={back} askAi={ai === '1'} />
      </Suspense>

      <details className="fold"><summary>처리 기록 {d.history.length}건</summary>
        <div className="panel">
          <p className="meta">날짜는 시연용 업무일이고, 시각은 실제로 기록된 시각입니다.</p>
          <ol className="hist">
            {d.history.map((h) => (
              <li key={h.id}>
                <div className="h-what">
                  <strong>{ACTION_LABEL[h.action] ?? h.action}</strong>
                  <span className="h-who">
                    {h.from.role === 'system' ? '자동 처리' : `${h.from.team}${h.from.name !== h.from.team ? `(${h.from.name})` : ''}`}
                    {h.to && <> <span aria-hidden="true">→</span><span className="sr"> 받는 부서 </span> {h.to.label}</>}
                  </span>
                </div>
                <div className="h-when">
                  <span className="num">{h.time}</span>
                  <span className="muted">{h.businessDate}{h.simulated ? ' · 시연' : ''}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </details>

      {i.kind === 'contract' && !['approved', 'closed', 'overdue'].includes(i.status) && canChangeContract(role) && (
        <details className="fold"><summary>시연: 고정 비용을 낮추자고 한다면?</summary>
          <form action={actProposeChange} className="hold">{hidden}
            <label>1년 고정 비용(원) <input name="fee" inputMode="numeric" placeholder="1800000000" required /></label>
            <button type="submit" className="secondary">이 조건으로 다시 계산하기</button>
          </form>
        </details>
      )}
      </div></div>
    </>
  );
}
