'use client';

import Link from 'next/link';
import { useState } from 'react';

/** "AI로 다시 쓰기": 누르자마자 대기 안내가 나오고, 기다리는 동안 다시 눌러도 요청이 겹치지 않는다. */
export function AiRewriteLink({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <p>
      <Link
        href={href}
        prefetch={false}
        aria-disabled={busy || undefined}
        onClick={(e) => {
          if (busy) e.preventDefault();
          else setBusy(true);
        }}
      >
        AI로 다시 쓰기
      </Link>
      <span role="status" aria-live="polite" className="aistate">
        {busy ? ' AI가 쓰는 중입니다. 최대 30초 걸릴 수 있습니다.' : ''}
      </span>
    </p>
  );
}
