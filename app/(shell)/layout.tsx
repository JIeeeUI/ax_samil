import type { ReactNode } from 'react';
import { getService } from '../../src/app/instance.js';
import { ROLES, ROLE_LABEL } from '../../src/workflow/roles.js';
import { setRole } from '../actions.js';
import { SCENARIO_LABEL } from '../components.js';
import { koDate } from '../plain.js';
import { currentRole } from '../session.js';
import { RoleSwitch, TabBar } from '../ui.js';

export const dynamic = 'force-dynamic';

export default async function Shell({ children }: { children: ReactNode }) {
  const svc = await getService();
  const [clock, scenario, role] = [await svc.getClock(), await svc.getScenario(), await currentRole()];
  return (
    <>
      <header className="top">
        <div className="brand">
          <strong>인플루언서 제안 심사</strong>
          <small>시연용 오늘 {koDate(clock.today)}{scenario !== 'baseline' && ` · 가정 변경 중(${SCENARIO_LABEL[scenario].split(' (')[0]})`}</small>
        </div>
        <RoleSwitch role={role} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} action={setRole} />
      </header>
      <main>{children}</main>
      <TabBar />
    </>
  );
}
