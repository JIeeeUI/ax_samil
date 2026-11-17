'use client';

import { Suspense, type ReactNode } from 'react';
import { ROLES, ROLE_LABEL } from '../../../src/workflow/roles.js';
import { SCENARIO_LABEL } from '../../../app/components.js';
import { koDate } from '../../../app/plain.js';
import { RoleSwitch, TabBar } from '../../../app/ui.js';
import { setRole } from '../../lib/actions.js';
import { Loading, storage, useLoad, useRole } from '../../lib/runtime.js';

export default function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const { data, error } = useLoad(async (svc) => ({ clock: await svc.getClock(), scenario: await svc.getScenario() }));
  return (
    <>
      <header className="top">
        <div className="brand">
          <strong>인플루언서 제안 심사</strong>
          <small>
            {data ? <>시연용 오늘 {koDate(data.clock.today)}{data.scenario !== 'baseline' && ` · 가정 변경 중(${SCENARIO_LABEL[data.scenario].split(' (')[0]})`}</> : '불러오는 중'}
          </small>
        </div>
        <RoleSwitch role={role} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} action={setRole} />
      </header>
      <main>
        <p className="meta" role="note">
          이 화면은 이 브라우저 안에서 실행됩니다. 누른 내용은 {storage.persistent ? '이 브라우저에만 저장되고' : '이 창을 닫으면 사라지고'} 다른 사람에게 보이지 않습니다.
          계산에는 대회 원본이 아니라 미리 계산한 결과가 들어 있습니다. 처음으로 돌리려면 설정의 “전체 초기화”를 누르십시오.
        </p>
        {error ? <Loading error={error} /> : (
          <Suspense fallback={<Loading error={null} />}>{children}</Suspense>
        )}
      </main>
      <TabBar />
    </>
  );
}
