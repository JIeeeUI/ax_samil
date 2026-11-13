'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

export interface ListRow {
  id: string;
  name: string; // 인플루언서
  kind: string; // 유형
  amountText: string;
  deadline: string; // 7월 17일
  daysLeft: string;
  who: string;
  status: string; // 진행 단계(짧게)
  check: string; // 재무 확인(대기·정상·정보 필요)
  checkTone: 'ok' | 'bad' | '';
  attnCount: number;
  attnTag: string;
  attnTier: 'high' | 'mid' | 'low' | '';
  mine: boolean;
  hay: string; // 검색용 문자열(화면에 보이지 않는 값 포함)
}

const INITIALS = 'ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊᄋᄌᄍᄎᄏᄐᄑᄒ';
const COMPAT = [0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143, 0x3145, 0x3146, 0x3147, 0x3148, 0x3149, 0x314a, 0x314b, 0x314c, 0x314d, 0x314e];

/** 대소문자·쉼표·한글 조합 중인 글자까지 맞추도록 정규화한다(글자를 자모로 풀어 비교). */
export function norm(s: string): string {
  const lower = s.toLowerCase().replace(/,/g, '');
  let out = '';
  for (const ch of lower.normalize('NFD')) {
    const k = COMPAT.indexOf(ch.codePointAt(0)!);
    out += k >= 0 ? INITIALS[k] : ch;
  }
  return out;
}

export function matches(row: ListRow, query: string): boolean {
  const tokens = norm(query.trim()).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = norm(`${row.hay} ${row.name} ${row.kind} ${row.amountText} ${row.deadline} ${row.who} ${row.status} ${row.check} ${row.attnTag}`);
  return tokens.every((t) => hay.includes(t));
}

export function TodayList({ rows, tabLabel }: { rows: ListRow[]; tabLabel: string }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const active = q.trim() !== '';
  const shown = active ? rows.filter((r) => matches(r, q)) : rows;
  const clear = () => {
    setQ('');
    input.current?.focus();
  };

  return (
    <>
      <div className="search">
        <label htmlFor="todo-search">검색</label>
        <div className="search-box">
          <input
            id="todo-search"
            ref={input}
            type="text"
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); clear(); } }}
            aria-describedby="todo-search-hint todo-search-count"
          />
          {active && <button type="button" className="sbtn" onClick={clear}>지우기</button>}
        </div>
        <p id="todo-search-hint" className="muted small">이름, 금액(만 원), 결정 기한(7/17), 결정자, 상태로 찾습니다. 현재 &lsquo;{tabLabel}&rsquo; 안에서 찾습니다.</p>
        <p id="todo-search-count" className="count" role="status" aria-live="polite" aria-atomic="true">
          {active ? `${rows.length}건 중 ${shown.length}건` : `${rows.length}건`}
        </p>
      </div>

      <table className="list">
        <thead>
          <tr><th>제안</th><th>유형</th><th className="num">금액</th><th>결정 기한</th><th>결정자</th><th>상태</th><th>재무 확인</th><th>주의할 점</th></tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id}>
              <td data-label="제안">
                <Link href={`/cases/${i.id}`} className="rowlink" aria-label={`${i.name} ${i.kind} ${i.amountText} 상세 열기`}>{i.name}</Link>
              </td>
              <td data-label="유형">{i.kind}</td>
              <td data-label="금액" className="num">{i.amountText}</td>
              <td data-label="결정 기한">{i.deadline} <span className="muted">{i.daysLeft}</span></td>
              <td data-label="결정자">{i.who}</td>
              <td data-label="상태">{i.mine && <strong>내 차례 · </strong>}{i.status}</td>
              <td data-label="재무 확인" className={i.checkTone ? `chk chk-${i.checkTone}` : 'chk'}>{i.check || '—'}</td>
              <td data-label="주의할 점">
                {i.attnCount === 0 ? <span className="muted">—</span> : (
                  <>
                    <span className={`tag tag-${i.attnTier}`}>{i.attnTag}</span>
                    <span className="muted nowrap"> 주의할 점 {i.attnCount}가지</span>
                  </>
                )}
              </td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr className="empty">
              <td colSpan={8}>
                {active ? (
                  <>&lsquo;{q.trim()}&rsquo;에 맞는 건이 없습니다. <button type="button" className="sbtn" onClick={clear}>검색 지우기</button></>
                ) : '해당하는 건이 없습니다.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
