import Link from 'next/link';
import { summarizeForApproval } from '../../../../src/ai/assist.js';
import { createProvider } from '../../../../src/ai/provider.js';
import { getService } from '../../../../src/app/instance.js';
import { decisionRole, ROLES, ROLE_LABEL } from '../../../../src/workflow/roles.js';
import {
  actClose, actConfirmFinance, actDecide, actProposeChange, actResubmit, actSubmit,
} from '../../../actions.js';
import { ACTION_LABEL, Badge, ESCALATION_LABEL, Flash, STATUS_LABEL, pct, routeTone, stageTone, won } from '../../../components.js';
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
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /></>;
  return (
    <>
      <Flash error={error} />
      <p><Link href="/">← 오늘 결정할 것</Link></p>
      <h1>{i.id} · {i.influencer} <Badge tone={routeTone(i.routeLevel)}>{i.routeLabel}</Badge> <Badge>{STATUS_LABEL[i.status]}</Badge></h1>
      {i.boardDate && <div className="flash flash-warn">CEO/이사회 상신 건: 기한 전 이사회 {i.boardDate}</div>}
      {d.escalation && (
        <div className="flash flash-error">
          <strong>D-3 에스컬레이션:</strong> 결정 없이 기한({i.effectiveDeadline})이 지나면 자동 확정(또는 확정 전 집행)됩니다. 선택지:{' '}
          {d.escalation.map((o) => ESCALATION_LABEL[o]).join(' / ')}
        </div>
      )}
      {d.linkWarnings.map((w) => <div key={w.influencerId} className="flash flash-warn">{w.message}</div>)}

      <section className="grid">
        <div><h3>요청</h3><dl>
          <dt>캠페인</dt><dd>{r.캠페인 || '(전속계약)'}</dd>
          <dt>요청액</dt><dd>{won(r.요청액)} ({r.금액규모})</dd>
          <dt>확정기한</dt><dd>{r.확정기한}</dd>
          <dt>집행 예정일</dt><dd>{r.집행예정일 || '미확인'}</dd>
          <dt>실효 결정 기한</dt><dd>{r.실효결정기한} <Badge tone={stageTone(r.알림단계)}>{r.알림단계 || `${r.남은일수}일 남음`}</Badge></dd>
        </dl></div>
        <div><h3>기안의 주장</h3><dl>
          <dt>예상 GMV</dt><dd>{r.기안예상GMV === '' ? '-' : won(r.기안예상GMV)}</dd>
          <dt>환산 명목 ROAS</dt><dd>{r.기안예상명목ROAS === '' ? '-' : r.기안예상명목ROAS}</dd>
        </dl><p className="meta">예상 GMV는 쿠폰·반품·광고비·물류비 차감 전 수치라 승인 근거가 될 수 없습니다.</p></div>
        <div><h3>과거 실질 성과</h3><dl>
          <dt>명목 ROAS / 실질 ROAS</dt><dd>{r.과거명목ROAS} / {r.과거실질ROAS}</dd>
          <dt>반품률 / 채널 기준</dt><dd>{pct(r.반품률)} / {pct(r.채널기준반품률)}</dd>
          <dt>명목 순위 → 실질 순위</dt><dd>{r.명목순위 || '-'} → {r.실질순위 || '-'}</dd>
          <dt>이슈</dt><dd>{i.issues.length ? i.issues.map((c) => <Badge key={c} tone="amber">{c}</Badge>) : '없음'}</dd>
        </dl></div>
        <div><h3>배분 점검</h3><dl>
          <dt>요청 비중</dt><dd>{pct(r.요청비중)}</dd>
          <dt>기존 집행 비중</dt><dd>{pct(r.기존집행비중)}</dd>
        </dl></div>
        <div><h3>현금·승인 판정</h3><dl>
          <dt>하회 구간</dt><dd>{r.하회구간}</dd>
          <dt>현금 유출일이 구간 안?</dt><dd>{r.하회구간해당}</dd>
          <dt>경로</dt><dd>{i.routeLabel}</dd>
          <dt>근거</dt><dd>{d.reasons.join(' / ')}</dd>
          {d.needsInfo.length > 0 && <><dt>필요 정보</dt><dd>{d.needsInfo.join(', ')}</dd></>}
        </dl></div>
        <div><h3>상태·연결 그룹</h3><dl>
          <dt>현재 상태</dt><dd>{STATUS_LABEL[i.status]}</dd>
          <dt>같은 인플루언서의 건</dt><dd>{d.group.map((g) => <span key={g.id}><Link href={`/cases/${g.id}`}>{g.id}</Link> ({STATUS_LABEL[g.status]}) </span>)}</dd>
          {d.penalty !== null && <><dt>갱신 직후 해지 시 위약금</dt><dd>{won(d.penalty)} <small>[가정: 잔여 고정 피 50%, 월할]</small></dd></>}
        </dl>{d.notes.map((n) => <p key={n} className="meta">{n}</p>)}</div>
      </section>

      <h2>상신 근거 요약 {summary.source === 'ai' ? <Badge tone="blue">AI</Badge> : <Badge>템플릿</Badge>} {summary.note && <small>{summary.note}</small>}</h2>
      <p>{summary.text}</p>
      <p><Link href={`${back}?ai=1`}>AI로 요약 다시 생성</Link> <small>(키가 없으면 템플릿으로 대체됩니다. AI는 승인·거절을 결정하지 않습니다.)</small></p>

      <h2>조작 <small>현재 역할: {ROLE_LABEL[role]}</small></h2>
      {i.status === 'finance_review' && (role === 'finance'
        ? <form action={actConfirmFinance}>{hidden}<button type="submit">재무 확인 완료 · 경로 판정</button></form>
        : <p>재무 확인은 {ROLE_LABEL.finance}가 합니다.</p>)}
      {i.status === 'routed' && ((role === 'marketing' || role === 'finance')
        ? <form action={actSubmit}>{hidden}<button type="submit">{i.routeLabel}로 상신</button></form>
        : <p>상신은 마케팅 담당 또는 재무팀이 합니다.</p>)}
      {i.status === 'submitted' && (role === decider ? (
        <div className="actions">
          <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="approve" /><button type="submit">승인</button></form>
          <form action={actDecide}>{hidden}<input type="hidden" name="decision" value="reject" /><button type="submit">거절</button></form>
          <form action={actDecide} className="hold">{hidden}<input type="hidden" name="decision" value="hold" />
            <label>필요한 정보 <input name="holdNeeded" defaultValue={d.needsInfo[0] ?? ''} required /></label>
            <label>담당 역할 <select name="holdOwner" defaultValue="finance">{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
            <label>회신 기한 <input type="date" name="holdDue" required /></label>
            <button type="submit">보류(확인 요청 생성)</button>
          </form>
        </div>
      ) : <p>이 건의 결재자는 <strong>{ROLE_LABEL[decider]}</strong>입니다. 역할을 전환해 결정할 수 있습니다(모의).</p>)}
      {i.status === 'rejected' && ((role === 'marketing' || role === 'finance')
        ? <div className="actions"><form action={actResubmit}>{hidden}<button type="submit">재상신</button></form><form action={actClose}>{hidden}<button type="submit">종결</button></form></div>
        : <p>거절된 건의 재상신·종결은 마케팅 담당 또는 재무팀이 합니다.</p>)}
      {i.status === 'on_hold' && <p>보류 중입니다. <Link href="/requests">확인 요청함</Link>에서 회신을 입력하면 재계산·재판정됩니다.</p>}
      {(i.status === 'approved' || i.status === 'closed' || i.status === 'overdue') && <p>종결된 건입니다. 더 이상 결정할 수 없습니다.</p>}

      {i.kind === 'contract' && i.status !== 'approved' && i.status !== 'closed' && i.status !== 'overdue' && (
        <form action={actProposeChange} className="hold">{hidden}
          <h3>모의 입력: 에이전시의 고정 피 조건 변경 제안</h3>
          <label>연 고정 피(원) <input name="fee" inputMode="numeric" placeholder="1800000000" required /></label>
          <label>현금 유출일(알면) <input type="date" name="cashOutflowDate" /></label>
          <button type="submit">제안 반영(모의)</button>
        </form>
      )}

      <h2>확인 요청</h2>
      {d.requests.length === 0 ? <p>없음</p> : (
        <ul>{d.requests.map((q) => (
          <li key={q.id}>#{q.id} {q.needed} → {ROLE_LABEL[q.ownerRole as keyof typeof ROLE_LABEL] ?? q.ownerRole} · 기한 {q.dueDate} · {q.status}{q.simulated && ' (모의)'}</li>
        ))}</ul>
      )}

      <h2>이력</h2>
      <table><thead><tr><th>업무일</th><th>행위자</th><th>행위</th><th>내용</th><th>가정</th></tr></thead>
        <tbody>{d.events.map((e) => (
          <tr key={e.id}>
            <td>{e.business_date}</td><td>{e.actor_role === 'system' ? '시스템' : ROLE_LABEL[e.actor_role as keyof typeof ROLE_LABEL] ?? e.actor_role}{e.simulated && <Badge tone="blue">모의</Badge>}</td>
            <td>{ACTION_LABEL[e.action] ?? e.action}</td>
            <td><small>{e.detail ? JSON.stringify(e.detail) : ''}</small></td><td><small>{e.assumption_version}</small></td>
          </tr>
        ))}</tbody></table>
    </>
  );
}
