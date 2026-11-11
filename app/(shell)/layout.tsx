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
          <Link href="/">오늘 결정할 것</Link>
          <Link href="/requests">확인 요청함</Link>
          <Link href="/settings">가정·기준값</Link>
        </nav>
        <form action={setRole} className="inline">
          <input type="hidden" name="back" value="/" />
          <label>역할(모의 전환){' '}
            <select name="role" defaultValue={role}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="submit">전환</button>
        </form>
      </header>
      <p className="meta">
        업무 기준일 {clock.asOf} · 현재 업무일 <strong>{clock.today}</strong> · 가정 시나리오: {SCENARIO_LABEL[scenario]} · 현재 역할: <strong>{ROLE_LABEL[role]}</strong>
      </p>
      <main>{children}</main>
    </>
  );
}
