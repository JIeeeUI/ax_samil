import Link from 'next/link';
import type { ReactNode } from 'react';
import { getService } from '../../src/app/instance.js';
import { ROLES, ROLE_LABEL } from '../../src/workflow/roles.js';
import { setRole } from '../actions.js';
import { SCENARIO_LABEL } from '../components.js';
import { currentRole } from '../session.js';

export const dynamic = 'force-dynamic';

export default async function Shell({ children }: { children: ReactNode }) {
  const svc = await getService();
  const [clock, scenario, role] = [await svc.getClock(), await svc.getScenario(), await currentRole()];
  return (
    <>
      <header className="top">
        <strong>인플루언서 제안 접수·판정</strong>
        <nav>
          <Link href="/">오늘 할 일</Link>
          <Link href="/requests">확인 요청</Link>
          <Link href="/settings">시계·설정</Link>
        </nav>
        <form action={setRole} className="inline">
          <input type="hidden" name="back" value="/" />
          <label>지금 보는 사람(시연용){' '}
            <select name="role" defaultValue={role}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="submit">전환</button>
        </form>
      </header>
      <p className="meta">
        오늘 날짜(시연용): <strong>{clock.today}</strong> · 보는 사람: <strong>{ROLE_LABEL[role]}</strong>
        {scenario !== 'baseline' && <> · <strong>가정을 바꿔 보는 중: {SCENARIO_LABEL[scenario]}</strong></>}
      </p>
      <main>{children}</main>
    </>
  );
}
