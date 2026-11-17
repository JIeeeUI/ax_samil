'use client';

import Link from 'next/link';
import { draftInfoRequest, structureReply } from '../../../../src/ai/assist.js';
import { canReply } from '../../../../src/workflow/ownership.js';
import { ROLE_LABEL, isRole } from '../../../../src/workflow/roles.js';
import { actReply } from '../../../lib/actions.js';
import { Badge, Flash } from '../../../../app/components.js';
import { koDate } from '../../../../app/plain.js';
import { requestLabel } from '../../../../src/workflow/requestKinds.js';
import { Loading, useLoad, useQuery, useRole } from '../../../lib/runtime.js';

const NEEDED_PAGE = (needed: string) => requestLabel(needed, 'page');
const REQ_STATUS: Record<string, string> = { requested: '답변 기다리는 중', replied: '답변 받음', closed: '종료' };
const CONTRACT = 'CONTRACT-INF-001';

export default function Requests() {
  const { error, req, text, draft } = useQuery();
  const role = useRole();
  const { data, error: loadError } = useLoad(async (svc) => {
    const today = (await svc.getClock()).today;
    const v = await svc.listToday();
    const all = (await Promise.all(v.items.map((i) => svc.getCase(i.id).then((d) => d.requests)))).flat().sort((a, b) => a.id - b.id);
    // 브라우저 실행판에서는 AI를 쓰지 않는다(키를 브라우저에 둘 수 없다). 자동 작성 문장과 규칙 기반 추출을 쓴다.
    const extracted = req && text ? await structureReply(text, null) : null;
    const draftReq = draft ? all.find((r) => String(r.id) === draft) ?? null : null;
    const draftOut = draftReq ? await draftInfoRequest(draftReq.needed, await svc.getCase(draftReq.caseId), null) : null;
    return { today, v, all, extracted, draftReq, draftOut };
  }, [req, text, draft]);
  if (!data) return <Loading error={loadError} />;
  const { today, v, all, extracted, draftReq, draftOut } = data;
  const name = new Map(v.items.map((i) => [i.id, i.influencer]));
  const status = new Map(v.items.map((i) => [i.id, i.status]));
  const open = all.filter((r) => r.status === 'requested');
  const done = all.filter((r) => r.status !== 'requested');

  return (
    <>
      <Flash error={error} />
      <h1>확인 요청</h1>

      {open.length === 0 && <p>답을 기다리는 요청이 없습니다. 건 상세에서 “보류”를 누르면 여기에 생겨요.</p>}
      {open.map((q) => {
        const late = q.dueDate < today;
        const can = canReply(role, q.ownerRole);
        const ownerName = isRole(q.ownerRole) ? ROLE_LABEL[q.ownerRole] : q.ownerRole;
        const isContractDate = q.caseId === CONTRACT && (q.needed === 'cash_outflow_date' || q.needed === 'payment_schedule');
        const typed = req && String(q.id) === req ? text : '';
        const prefill = extracted && String(q.id) === req ? extracted.candidates : {};
        const preset = (label: string, date: string | null, msg: string) => (
          <form action={actReply} className="inline">
            <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" />
            <input type="hidden" name="text" value={msg} />{date && <input type="hidden" name="cashOutflowDate" value={date} />}
            <button type="submit" className="secondary">{label}</button>
          </form>
        );
        return (
          <section key={q.id} className="card-block">
            <h3><Link href={`/cases/${q.caseId}`}>{name.get(q.caseId)} {q.caseId.startsWith('CONTRACT') ? '연간 계약' : '캠페인'}</Link> — {NEEDED_PAGE(q.needed)} 확인</h3>
            <p>
              답변 담당 <strong>{isRole(q.ownerRole) ? ROLE_LABEL[q.ownerRole] : q.ownerRole}</strong> · 기한 <strong>{koDate(q.dueDate)}</strong>
              {late && <> <Badge tone="red">기한이 지났습니다</Badge></>}
            </p>
            {q.replyText && <p className="meta">앞서 받은 답변(필요한 값이 없어 계속 기다리는 중): {q.replyText}</p>}

            {!can ? (
              <p className="meta">{ownerName}의 회신을 기다리는 중입니다. 지금 보는 사람({ROLE_LABEL[role]})은 답변을 입력할 수 없습니다(담당 또는 결재자만 가능).</p>
            ) : isContractDate ? (
              <>
                <div className="actions quick">
                  {preset('유리한 답변: 9월 30일에 지급', '2026-09-30', '유리한 회신(모의): 고정 비용은 2026-09-30에 지급합니다.')}
                  {preset('불리한 답변: 8월 10일에 지급', '2026-08-10', '불리한 회신(모의): 고정 비용은 2026-08-10에 지급합니다.')}
                  {preset('답변 지연: 일정 미정', null, '지연 회신(모의): 지급 일정은 아직 미정입니다.')}
                </div>
                <details className="fold"><summary>다른 날짜를 직접 입력</summary>
              <form action={actReply} className="hold">
                <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" />
                <label>돈이 나가는 날짜 <input type="date" name="cashOutflowDate" defaultValue={prefill.cashOutflowDate ?? ''} /></label>
                <label>메모(선택) <input name="text" size={30} defaultValue={typed} placeholder="예: 8월 10일 지급 예정" /></label>
                <button type="submit">답변 입력하고 다시 계산</button>
              </form>
                </details>
              </>
            ) : (
              <form action={actReply} className="hold">
                <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" /><input type="hidden" name="resolved" value="1" />
                <label>답변 내용 <input name="text" size={40} required defaultValue={typed} placeholder="예: 추가 자료를 첨부했습니다" /></label>
                <button type="submit">{status.get(q.caseId) === 'on_hold' ? '답변 완료 (보류 풀기)' : '답변 완료'}</button>
              </form>
            )}

            <details className="fold"><summary>도움말·시연용 버튼</summary>
              <p><Link href={`/requests?draft=${q.id}`}>이 요청을 보내는 글 초안 보기</Link></p>
              {draftOut && draftReq?.id === q.id && (
                <blockquote>{draftOut.text} <small>({draftOut.source === 'ai' ? 'AI 작성' : '자동 작성'}{draftOut.note && ` · ${draftOut.note}`})</small></blockquote>
              )}
              {can && isContractDate && (
                <>
                  <form method="get" action="/requests" className="inline">
                    <input type="hidden" name="req" value={q.id} />
                    <label>답변 글에서 날짜 뽑아 보기 <input name="text" size={40} defaultValue={typed} placeholder="예: 지급일은 2026-08-10입니다" /></label>
                    <button type="submit" className="secondary">날짜 찾기</button>
                  </form>
                  {extracted && String(q.id) === req && (
                    <p className="meta">찾은 값: {prefill.cashOutflowDate ?? '없음'} ({extracted.source === 'ai' ? 'AI' : '자동'}{extracted.note && `, ${extracted.note}`}) — 위 입력칸에 채워 두었으니 확인한 뒤 눌러 주십시오.</p>
                  )}
                </>
              )}
            </details>
          </section>
        );
      })}

      <details className="fold"><summary>처리된 요청 {done.length}건</summary>
        {done.length === 0 ? <p>아직 없습니다.</p> : (
          <ul>{done.map((q) => (
            <li key={q.id}>{name.get(q.caseId)}({q.caseId}) · {NEEDED_PAGE(q.needed)} · {REQ_STATUS[q.status] ?? q.status}{q.repliedDate && ` (${q.repliedDate})`}</li>
          ))}</ul>
        )}
      </details>
    </>
  );
}
