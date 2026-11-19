import { SCENARIOS, THRESHOLDS } from '../../../src/engine/assumptions.js';
import { getService } from '../../../src/app/instance.js';
import { actAdvanceClock, actReset, actSetConfig, actSetReturnReasons, actSetScenario } from '../../actions.js';
import { ALERT_PLANS, MESSAGE_TEXT } from '../../../src/workflow/alertPlan.js';
import { RETURN_REASONS, RETURN_REASON_LABEL, SCHEDULE } from '../../../src/workflow/schedule.js';
import { ROLE_LABEL } from '../../../src/workflow/roles.js';
import { Badge, Flash, LABEL_KO, SCENARIO_LABEL, won } from '../../components.js';

export const dynamic = 'force-dynamic';

const SCENARIO_WHY: Record<string, string> = {
  baseline: '기본값입니다. 연체된 외상 대금은 기준일에 받고 낸다고 보고, LC-0001 대금은 90일 뒤에 받는다고 봅니다.',
  arOverdueExcluded: '기준일 전에 이미 늦어진 외상매출은 못 받는다고 가정해 봅니다.',
  apOverdueExcluded: '기준일 전에 이미 늦어진 외상매입은 내지 않는다고 가정해 봅니다.',
  bothOverdueExcluded: '연체된 외상매출·외상매입을 모두 빼고 계산해 봅니다.',
  lc45: 'LC-0001 대금을 45일 뒤에 받는다고 가정합니다. 재무팀 공식 전망이 왜 다른지 설명할 때만 쓰는 점검용입니다(확인된 조건은 90일).',
};
const FIELD_KO: Record<string, string> = {
  returnAttribution: '반품을 인플루언서 성과에 반영하는 범위', unitsPerOrder: '주문 1건당 판매 수량', channelFeeBasis: '판매 채널 수수료 기준', recoverCostOnRefund: '환불되면 원가·수수료를 돌려받는지',
  calcMode: '이익 계산 방식', overdueAr: '기준일 전 연체 외상매출', overdueAp: '기준일 전 연체 외상매입', lc0001TermsDays: 'LC-0001 대금 회수일(일)',
};
const THRESHOLD_KO: Record<string, string> = {
  perItemKrw: '건별 승인 한도(원)', planTotalKrw: '기안 총액 한도(원)', contractAnnualKrw: '전속계약 연 한도(원)',
  covenantMinKrw: '지켜야 하는 최소 현금(원)', returnIssuePp: '반품률이 기준보다 몇 %p 높으면 문제로 볼지', minOrders: '판단하려면 필요한 최소 주문 수',
  alertDays: '기한 며칠 전에 알릴지', boardDate: '이사회 날짜',
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const svc = await getService();
  const [scenario, clock, cfg] = [await svc.getScenario(), await svc.getClock(), await svc.getConfig()];
  const plan = ALERT_PLANS[cfg.alertPlan];
  const planState = await svc.alertPlanStatus('CONTRACT-INF-001');
  const STATE_KO: Record<string, string> = { sent: '발송됨(모의)', passed: '알림 시점 지남', scheduled: '예정', due: '대기', not_applicable: '해당 없음' };
  const a = SCENARIOS[scenario];
  const hidden = <input type="hidden" name="back" value="/settings" />;
  return (
    <>
      <Flash error={error} />
      <h1>시계·설정</h1>

      <section className="card-block">
        <h2>오늘 날짜 옮기기 <small>(지금: {clock.today})</small></h2>
        <p>시연에서는 실제 날짜 대신 “가상의 오늘”을 씁니다. 날짜를 앞으로 옮기면 기한이 다가오는 건에 알림이 생기고, 기한이 지나면 <strong>자동 확정으로 기록</strong>됩니다. 되돌릴 수는 없습니다.</p>
        <form action={actAdvanceClock} className="hold">{hidden}
          <label>이 날짜로 옮기기 <input type="date" name="date" defaultValue={clock.today} min={clock.today} required /></label>
          <button type="submit">날짜 옮기기</button>
        </form>
        <p className="meta">예: 2026-07-14로 옮기면 혜인 전속계약(기한 7/17)에 “기한이 곧 다가옵니다” 알림이 생겨요.</p>
      </section>

      <section className="card-block">
        <h2>처음부터 다시 하기</h2>
        <p>모든 건을 처음 상태로 되돌리고 오늘 날짜를 {clock.asOf}로 돌립니다. 지금까지 눌러 본 기록은 사라져요.</p>
        <form action={actReset}>{hidden}<button type="submit" className="secondary">전체 초기화</button></form>
      </section>

      <section className="card-block">
        <h2>확장 기능(결재 이후) 보기</h2>
        <p>이 도구의 중심은 상신 전 점검입니다. 결재 이후 기능(재무 반려·마케팅 회신·통보 작업·1차/2차 결재·알림 계획표)은 구현돼 있지만 기본으로 숨겨져 있습니다. 켜면 화면에 나타납니다.</p>
        <form key={`ext-${cfg.showExtended}`} action={actSetConfig} className="hold">{hidden}
          <label>확장 기능 보기 <select name="showExtended" defaultValue={cfg.showExtended ? 'on' : 'off'}><option value="off">끄기(기본)</option><option value="on">켜기</option></select></label>
          <button type="submit">저장</button>
        </form>
      </section>

      {cfg.showExtended && (<>
      <section className="card-block">
        <h2>결재·알림 설정 <Badge tone="amber">가정</Badge></h2>
        <p>교육용으로 정한 값입니다. 기본은 “꺼짐 / 기본 알림”이고, 켜면 CEO/이사회 건에 1차 대표 검토가 추가됩니다. 알림은 모두 앱 안의 <strong>모의 알림</strong>입니다.</p>
        <form key={`cfg-${cfg.twoStage}-${cfg.urgentDays}-${cfg.holdCapDays}-${cfg.alertPlan}`} action={actSetConfig} className="hold">{hidden}
          <label>1차/2차 결재 <select name="twoStage" defaultValue={cfg.twoStage ? 'on' : 'off'}><option value="off">끄기(기본, 1단계)</option><option value="on">켜기(대표 검토 → CEO 결정)</option></select></label>
          <label>긴급 기준(결정 기한 며칠 전부터) <input type="number" name="urgentDays" min={1} max={60} defaultValue={cfg.urgentDays} /></label>
          <label>1차 보류 상한(결정 기한 며칠 전까지) <input type="number" name="holdCapDays" min={0} max={30} defaultValue={cfg.holdCapDays} /></label>
          <label>알림 계획표 <select name="alertPlan" defaultValue={cfg.alertPlan}>{Object.values(ALERT_PLANS).map((p) => <option key={p.id} value={p.id}>{p.id} — {p.label}</option>)}</select></label>
          <button type="submit">설정 저장</button>
        </form>
        <h3>활성 알림 계획표: {plan.id} <small>버전 {plan.version} · {plan.retroactive ? '지난 단계도 만듦' : '지난 단계는 만들지 않고 “알림 시점 지남”으로만 표시'}</small></h3>
        <table className="plan"><thead><tr><th>단계</th><th>받는 사람</th><th>메시지</th><th>혜인 전속계약(결정 기한 7/17)</th></tr></thead><tbody>
          {plan.rows.map((row, n) => (
            <tr key={n}>
              <td>D-{row.daysBefore}{row.kind === 'escalation' ? ' 상급자 경고' : ''}</td>
              <td>{[...row.audienceRoles, ...(row.decisionRoles ?? [])].map((r) => ROLE_LABEL[r]).join(', ')}</td>
              <td><small>{MESSAGE_TEXT[row.messageKey]}{row.decisionRoles ? ` (${row.decisionRoles.map((r) => ROLE_LABEL[r]).join('·')}에게는 결정 준비가 됐으면 결정 요청, 안 됐으면 ‘아직 준비 안 됨’ 경고만)` : ''}</small></td>
              <td>{STATE_KO[planState[n]?.state ?? 'scheduled']} <small>({planState[n]?.triggerDate})</small></td>
            </tr>
          ))}
        </tbody></table>
        {plan.holdOverdueWarning && <p className="meta">1차 보류가 자기 기한을 넘기면 즉시 대표·CEO에게 경고합니다.</p>}
      </section>

      <section className="card-block">
        <h2>재무 반려 사유·역산 일정 <Badge tone="amber">가정</Badge></h2>
        <p>재무팀이 마케팅에 되돌릴 때(반려) 고를 수 있는 사유입니다. 끄면 선택지에서 사라집니다.</p>
        <form key={`rr-${RETURN_REASONS.map((k) => (cfg.returnReasons[k] ? 1 : 0)).join('')}`} action={actSetReturnReasons} className="hold">{hidden}
          {RETURN_REASONS.map((k) => <label key={k}><input type="checkbox" name={`rr_${k}`} defaultChecked={cfg.returnReasons[k]} /> {RETURN_REASON_LABEL[k]}</label>)}
          <button type="submit">반려 사유 저장</button>
        </form>
        <h3>시간 규칙은 하나의 원칙: 결정 기한에서 거꾸로 센다</h3>
        <ul className="plain">
          <li><strong>결재자 몫</strong>: 결정 기한 3일 전 ~ 당일 (그래서 1차 보류는 기한 {SCHEDULE.approverDays}일 전까지만)</li>
          <li><strong>재무 재확인 몫</strong>: 기한 5일 전 ~ 3일 전</li>
          <li><strong>마케팅·협의 몫</strong>: 기한 5일 전 이전</li>
          <li>반려 회신 기한 = 반려일 + 3일과 (결정 기한 − 5일) 중 이른 날</li>
          <li>결정 기한까지 5일 이하이면 반려하지 않고 재무 의견을 붙여 바로 상신 · 반려는 건당 한 번(왕복 1회)</li>
          <li>회신 기한까지 답이 없으면 “미응답”으로 표시하고 재무 의견을 붙여 결재자에게 자동 전달(결정이 아니라 전달)</li>
        </ul>
        <p className="meta">기존 값(알림 D-14/7/3, 긴급 10일, 확인 요청 +3일)은 그대로입니다.</p>
      </section>
      </>)}

      <h2>가정을 바꿔 보기</h2>
      <p>현금 계산에는 자료에 없어서 정한 가정이 들어 있습니다. 가정을 바꾸면 현금이 부족해지는 기간이 달라지고, 그에 따라 <strong>누가 승인해야 하는지</strong>도 달라질 수 있습니다. 아직 끝나지 않은 건만 다시 계산됩니다.</p>
      <div className="scenarios">
        {(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((id) => (
          <form key={id} action={actSetScenario} className={`scn${id === scenario ? ' on' : ''}`}>{hidden}
            <input type="hidden" name="scenario" value={id} />
            <strong>{SCENARIO_LABEL[id]}</strong> {id === scenario && <Badge tone="blue">지금 이 가정</Badge>}
            <p>{SCENARIO_WHY[id]}</p>
            {id !== scenario && <button type="submit" className="secondary">이 가정으로 바꿔 보기</button>}
          </form>
        ))}
      </div>

      <details className="fold"><summary>지금 쓰는 가정과 기준값 자세히 (확정 / 가정 표시)</summary>
        <h3>가정 <small>{a.id} · 버전 {a.version}</small></h3>
        <table><thead><tr><th>항목</th><th>값</th><th>출처</th></tr></thead><tbody>
          {Object.entries(FIELD_KO).map(([k, name]) => (
            <tr key={k}><td>{name}</td><td>{String((a as unknown as Record<string, unknown>)[k])}</td>
              <td><Badge tone={a.labels[k as keyof typeof a.labels] === 'confirmed' ? 'green' : 'amber'}>{LABEL_KO[a.labels[k as keyof typeof a.labels]]}</Badge></td></tr>
          ))}
        </tbody></table>
        <h3>기준값</h3>
        <table><thead><tr><th>기준</th><th>값</th><th>출처</th></tr></thead><tbody>
          {Object.entries(THRESHOLD_KO).map(([k, name]) => {
            const raw = (THRESHOLDS as unknown as Record<string, unknown>)[k];
            const label = (THRESHOLDS.labels as Record<string, keyof typeof LABEL_KO>)[k];
            return (
              <tr key={k}><td>{name}</td>
                <td>{typeof raw === 'number' && raw >= 1_000_000 ? won(raw) : Array.isArray(raw) ? raw.join('일 / ') + '일 전' : String(raw)}</td>
                <td><Badge tone={label === 'confirmed' ? 'green' : 'amber'}>{LABEL_KO[label]}</Badge></td></tr>
            );
          })}
        </tbody></table>
        <p className="meta">“확정”은 원본 자료에 있는 값, “가정”은 자료에 없어서 정한 값, “벤치마크”는 업계 참고값입니다.</p>
      </details>

      <details className="fold"><summary>이 시스템에서 진짜 되는 것과 시연으로 보여 주는 것</summary>
        <table><tbody>
          <tr><th>실제로 계산·기록되는 것</th><td>이익 계산, 문제 표시, 현금 부족 기간, 누가 승인할지, 결정 기한, 상태·처리 기록, 알림, 확인 요청 생성, AI 문장 숫자 검증</td></tr>
          <tr><th>시연용(가상)으로 입력하는 것</th><td>CEO·대표의 결정, 계약 담당·에이전시의 답변, 통보 발송</td></tr>
          <tr><th>아직 설계만 한 것</th><td>계약 구조 비교, 광고비 중복 점검</td></tr>
        </tbody></table>
      </details>
    </>
  );
}
