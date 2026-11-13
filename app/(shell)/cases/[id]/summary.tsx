import Link from 'next/link';
import { summarizeForApproval } from '../../../../src/ai/assist.js';
import { createProvider } from '../../../../src/ai/provider.js';
import type { AiErrorCode } from '../../../../src/ai/provider.js';
import type { CaseDetail } from '../../../../src/app/service.js';
import { formal } from '../../../formal.js';

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

const ERROR_TEXT: Record<AiErrorCode, string> = {
  no_key: 'AI 키가 설정되지 않아 기본 문장을 보여 줍니다.',
  timeout: 'AI 연결에 실패해 기본 문장을 보여 줍니다.',
  http_error: 'AI 연결에 실패해 기본 문장을 보여 줍니다.',
  verify_failed: 'AI 문장의 숫자가 맞지 않아 기본 문장을 보여 줍니다.',
};

/** 결재자용 요약 문장. AI를 요청하면 응답을 기다리는 동안 이 부분만 '쓰는 중'으로 보이고, 실패해도 기본 문장이나 안내가 나온다. */
export async function ApproverSummary({ d, back, askAi }: { d: CaseDetail; back: string; askAi: boolean }) {
  let result;
  try {
    result = await summarizeForApproval(d, askAi ? createProvider(process.env) : null, { requested: askAi });
  } catch {
    return (
      <details className="fold" open={askAi}><summary>결재자용 요약 문장</summary>
        <div className="panel">
          <p className="aistate bad" role="status">요약을 불러오지 못했습니다. 잠시 뒤 다시 시도하십시오.</p>
          <p><Link href={`${back}?ai=1`}>AI로 다시 쓰기</Link></p>
        </div>
      </details>
    );
  }
  const { text, source, note, error, status } = result;
  const busy = error === 'http_error' && (status === 503 || status === 429);
  return (
    <details className="fold" open={askAi}><summary>결재자용 요약 문장 {source === 'ai' ? '(AI 작성)' : '(자동 작성)'}</summary>
      <div className="panel">
        {source === 'ai' && <p className="aistate muted" role="status">AI 작성</p>}
        {source === 'fallback' && error && (
          <p className="aistate bad" role="status">
            {busy ? '구글 서버가 바쁩니다. 잠시 뒤 다시 눌러 주세요.' : (ERROR_TEXT[error] ?? ERROR_TEXT.http_error)}
            {error === 'http_error' && status !== undefined && <small> (상태 {status})</small>}
          </p>
        )}
        <ul className="lines">{sentences(formal(text)).map((s) => <li key={s}>{s}</li>)}</ul>
        {note && !error && <p className="meta">{formal(note)}</p>}
        <p><Link href={`${back}?ai=1`}>AI로 다시 쓰기</Link></p>
      </div>
    </details>
  );
}

export function SummaryLoading() {
  return (
    <details className="fold" open><summary>결재자용 요약 문장</summary>
      <div className="panel"><p className="aistate" role="status" aria-live="polite">AI로 다시 쓰는 중…</p></div>
    </details>
  );
}
