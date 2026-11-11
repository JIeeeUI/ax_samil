import Link from 'next/link';
import { draftInfoRequest, structureReply } from '../../../src/ai/assist.js';
import { createProvider } from '../../../src/ai/provider.js';
import { getService } from '../../../src/app/instance.js';
import { ROLE_LABEL, isRole } from '../../../src/workflow/roles.js';
import { actReply } from '../../actions.js';
import { Badge, Flash } from '../../components.js';

export const dynamic = 'force-dynamic';

export default async function Requests({
  searchParams,
}: { searchParams: Promise<{ error?: string; req?: string; text?: string; draft?: string }> }) {
  const { error, req, text, draft } = await searchParams;
  const svc = await getService();
  const today = (await svc.getClock()).today;
  const v = await svc.listToday();
  const ids = v.items.map((i) => i.id);
  const all = (await Promise.all(ids.map((id) => svc.getCase(id).then((d) => d.requests)))).flat().sort((a, b) => a.id - b.id);
  const open = all.filter((r) => r.status === 'requested');
  const done = all.filter((r) => r.status !== 'requested');
  const ai = createProvider(process.env);
  const extracted = req && text ? await structureReply(text, ai) : null;
  const draftDetail = draft ? await svc.getCase(all.find((r) => String(r.id) === draft)?.caseId ?? ids[0]) : null;
  const draftReq = draft ? all.find((r) => String(r.id) === draft) : null;
  const draftOut = draftDetail && draftReq ? await draftInfoRequest(draftReq.needed, draftDetail, ai) : null;

  return (
    <>
      <Flash error={error} />
      <h1>확인 요청함</h1>
      <p className="meta">담당과 기한이 붙은 미확인 정보 요청입니다. 회신은 모두 <Badge tone="blue">모의</Badge>로 기록됩니다.</p>
      {open.length === 0 && <p>열린 확인 요청이 없습니다.</p>}
      {open.map((q) => {
        const late = q.dueDate < today;
        const prefill = extracted && String(q.id) === req ? extracted.candidates : {};
        const preset = (label: string, date: string | null, msg: string) => (
          <form action={actReply} className="inline">
            <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" />
            <input type="hidden" name="text" value={msg} />{date && <input type="hidden" name="cashOutflowDate" value={date} />}
            <button type="submit">{label}</button>
          </form>
        );
        return (
          <section key={q.id} className="card-block">
            <h3>#{q.id} <Link href={`/cases/${q.caseId}`}>{q.caseId}</Link> · {q.needed} {late && <Badge tone="red">기한 초과</Badge>}</h3>
            <p>담당 {isRole(q.ownerRole) ? ROLE_LABEL[q.ownerRole] : q.ownerRole} · 회신 기한 {q.dueDate} · 요청일 {q.createdDate}{q.simulated && ' · 모의'}</p>
            {q.replyText && <p className="meta">이전 회신(값 없음): {q.replyText}</p>}
            <p><Link href={`/requests?draft=${q.id}`}>요청서 초안 보기</Link></p>
            {draftOut && draftReq?.id === q.id && (
              <blockquote>{draftOut.text} {draftOut.source === 'ai' ? <Badge tone="blue">AI</Badge> : <Badge>템플릿</Badge>} {draftOut.note && <small>{draftOut.note}</small>}</blockquote>
            )}
            {q.caseId === 'CONTRACT-INF-001' ? (
            <div className="actions">
              {preset('유리한 회신(모의): 9/30 지급', '2026-09-30', '유리한 회신(모의): 고정 피는 2026-09-30에 지급합니다.')}
              {preset('불리한 회신(모의): 8/10 지급', '2026-08-10', '불리한 회신(모의): 고정 피는 2026-08-10에 지급합니다.')}
              {preset('지연 회신(모의): 일정 미정', null, '지연 회신(모의): 지급 일정은 아직 미정입니다.')}
            </div>
            ) : null}
            <form action={actReply} className="inline">
              <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" /><input type="hidden" name="resolved" value="1" />
              <label>값이 필요 없는 회신(예: 추가 자료) <input name="text" size={36} required /></label>
              <button type="submit">회신 완료(보류 해제·재판정)</button>
            </form>
            <form method="get" action="/requests" className="inline">
              <input type="hidden" name="req" value={q.id} />
              <label>회신 원문 <input name="text" size={48} defaultValue={req && String(q.id) === req ? text : ''} placeholder="예: 지급일은 2026-08-10입니다" /></label>
              <button type="submit">값 후보 추출</button>
            </form>
            {extracted && String(q.id) === req && (
              <p className="meta">추출 후보: {JSON.stringify(extracted.candidates)} ({extracted.source === 'ai' ? 'AI' : '템플릿'}{extracted.note && `, ${extracted.note}`}) — 아래 값을 확인한 뒤 반영하세요.</p>
            )}
            <form action={actReply} className="hold">
              <input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="back" value="/requests" />
              <label>회신 내용 <input name="text" size={40} defaultValue={req && String(q.id) === req ? text : ''} /></label>
              <label>현금 유출일 <input type="date" name="cashOutflowDate" defaultValue={prefill.cashOutflowDate ?? ''} /></label>
              <label>연 고정 피(원) <input name="fee" inputMode="numeric" defaultValue={prefill.annualFixedFeeKrw ?? ''} /></label>
              <button type="submit">회신 반영(모의) · 재계산</button>
            </form>
          </section>
        );
      })}
      <h2>처리된 요청</h2>
      {done.length === 0 ? <p>없음</p> : <ul>{done.map((q) => <li key={q.id}>#{q.id} {q.caseId} · {q.needed} · {q.status} {q.repliedDate && `(${q.repliedDate})`} {q.replyValues && <small>{JSON.stringify(q.replyValues)}</small>}</li>)}</ul>}
    </>
  );
}
