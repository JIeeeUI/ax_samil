'use client';

import { useEffect, useState } from 'react';
import { summarizeForApproval, type AssistResult } from '../../../../../src/ai/assist.js';
import type { CaseDetail } from '../../../../../src/app/service.js';
import { formal } from '../../../../../app/formal.js';

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

/** 결재자용 요약 문장. 브라우저 실행판에서는 AI를 쓰지 않고, 확인된 숫자만 채운 자동 작성 문장을 보여 준다. */
export function ApproverSummary({ d }: { d: CaseDetail }) {
  const [r, setR] = useState<AssistResult | null>(null);
  useEffect(() => {
    let alive = true;
    summarizeForApproval(d, null, { requested: false }).then((x) => { if (alive) setR(x); }, () => { if (alive) setR(null); });
    return () => { alive = false; };
  }, [d]);
  return (
    <details className="fold"><summary>결재자용 요약 문장 (자동 작성)</summary>
      <div className="panel">
        {r === null ? <p className="aistate" role="status">문장을 만드는 중입니다…</p> : (
          <>
            <ul className="lines">{sentences(formal(r.text)).map((s) => <li key={s}>{s}</li>)}</ul>
            {r.note && <p className="meta">{formal(r.note)}</p>}
          </>
        )}
        <p className="meta">이 실행판은 브라우저 안에서 돌아서 AI 문장 다듬기를 쓰지 않습니다(키를 브라우저에 둘 수 없음). 로컬 서버(npm run dev)에서는 키를 넣으면 AI를 쓸 수 있습니다.</p>
      </div>
    </details>
  );
}
