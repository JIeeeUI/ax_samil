import type { ReactNode } from 'react';
import { formal } from './formal.js';

/** ① 승인 ② 기한 ③ 근거 ④ 빠진 정보 — 점검 네 줄의 이름표 */
const KEYS = ['승인', '기한', '근거', '빠진 정보'];

/** 문장을 '핵심 한 줄'과 '나머지'로 나눈다(문장 끝 마침표, 줄표(—), 세미콜론 기준). */
function split(text: string): { head: string; rest: string[] } {
  const parts = text.split(/(?<=\.)\s+|\s+—\s+|;\s+/).map((p) => p.trim()).filter(Boolean);
  const [head = '', ...rest] = parts;
  return { head: head.replace(/\.$/, ''), rest };
}

/** 상신 전 점검 네 줄: 이름표 + 핵심 한 줄, 나머지는 '자세히'로 접는다. */
export function CheckList({ lines }: { lines: string[] }) {
  return (
    <ol className="checklist">
      {lines.map((raw, n) => {
        const { head, rest } = split(formal(raw).replace(/^[①②③④]\s*/, ''));
        const last = n === 3; // ④(빠진 정보)의 안내 문장은 접지 않고 보여 준다
        return (
          <li key={raw}>
            <span className="ck">{KEYS[n] ?? ''}</span>
            <div className="cv">
              <strong>{head}</strong>
              {rest.length > 0 && last && <span className="cs">{rest.join(' ')}</span>}
              {rest.length > 0 && !last && (
                <details className="more">
                  <summary>자세히</summary>
                  {rest.map((r) => <p key={r}>{r}</p>)}
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** 공식 현금 전망과 재계산이 다를 때: 핵심 두 줄만 보이고 이유는 접는다. */
export function CashNote({ lines, unverified }: { lines: string[]; unverified: string[] }): ReactNode {
  const [official, recalc, ...why] = lines.map(formal);
  return (
    <div className="flash flash-warn cashnote">
      <strong>재무 확인 필요</strong> <small>공식 현금 전망과 계산 결과가 다릅니다</small>
      <ul className="short">
        {official && <li>{official}</li>}
        {recalc && <li>{recalc}</li>}
      </ul>
      {(why.length > 0 || unverified.length > 0) && (
        <details className="more">
          <summary>차이 사유</summary>
          {why.map((w) => <p key={w}>{w}</p>)}
          {unverified.length > 0 && <p className="meta">{formal(unverified.join(' · '))}</p>}
        </details>
      )}
    </div>
  );
}
