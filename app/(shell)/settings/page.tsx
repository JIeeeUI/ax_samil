import { SCENARIOS, THRESHOLDS } from '../../../src/engine/assumptions.js';
import { getService } from '../../../src/app/instance.js';
import { actAdvanceClock, actReset, actSetScenario } from '../../actions.js';
import { Badge, Flash, LABEL_KO, SCENARIO_LABEL, won } from '../../components.js';

export const dynamic = 'force-dynamic';

const FIELD_KO: Record<string, string> = {
  unitsPerOrder: '주문당 판매 수량', channelFeeBasis: '채널수수료 기준', recoverCostOnRefund: '환불 시 원가·수수료 회수',
  calcMode: '공헌이익 산식', overdueAr: '기준일 전 연체 AR', overdueAp: '기준일 전 연체 AP', lc0001TermsDays: 'LC-0001 결제조건(일)',
};
const THRESHOLD_KO: Record<string, string> = {
  perItemKrw: '건별 승인 한도(원)', planTotalKrw: '기안 총액 한도(원)', contractAnnualKrw: '전속계약 연 한도(원)',
  covenantMinKrw: 'covenant 최소 현금(원)', returnIssuePp: '반품률 이슈 기준(%p 초과)', minOrders: '표본 부족 기준(주문 수)',
  alertDays: '기한 알림(D-n)', boardDate: '이사회 날짜',
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const svc = await getService();
  const [scenario, clock] = [await svc.getScenario(), await svc.getClock()];
  const a = SCENARIOS[scenario];
  const hidden = <input type="hidden" name="back" value="/settings" />;
  return (
    <>
      <Flash error={error} />
      <h1>가정·기준값</h1>
      <h2>시나리오 전환 <small>(종결되지 않은 건만 재판정됩니다)</small></h2>
      <div className="actions">
        {(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((id) => (
          <form key={id} action={actSetScenario}>{hidden}<input type="hidden" name="scenario" value={id} />
            <button type="submit" disabled={id === scenario}>{SCENARIO_LABEL[id]}{id === scenario && ' (현재)'}</button></form>
        ))}
      </div>
      <p className="meta">LC-0001 45일은 재무 공식 전망이 왜 다른지 설명하는 민감도 점검용입니다. 통보서로 확인된 90일 조건을 대체하지 않습니다.</p>

      <h2>현재 가정 세트 <small>{a.id}@{a.version}</small></h2>
      <table><thead><tr><th>항목</th><th>값</th><th>라벨</th></tr></thead><tbody>
        {Object.entries(FIELD_KO).map(([k, name]) => (
          <tr key={k}><td>{name}</td><td>{String((a as unknown as Record<string, unknown>)[k])}</td><td><Badge tone={a.labels[k as keyof typeof a.labels] === 'confirmed' ? 'green' : 'amber'}>{LABEL_KO[a.labels[k as keyof typeof a.labels]]}</Badge></td></tr>
        ))}
      </tbody></table>

      <h2>기준값 (A 원본 확정 / C 제안 기본값)</h2>
      <table><thead><tr><th>기준</th><th>값</th><th>라벨</th></tr></thead><tbody>
        {Object.entries(THRESHOLD_KO).map(([k, name]) => {
          const raw = (THRESHOLDS as unknown as Record<string, unknown>)[k];
          const label = (THRESHOLDS.labels as Record<string, keyof typeof LABEL_KO>)[k];
          return (
            <tr key={k}><td>{name}</td>
              <td>{typeof raw === 'number' && raw >= 1_000_000 ? won(raw) : Array.isArray(raw) ? raw.join(' / ') : String(raw)}</td>
              <td><Badge tone={label === 'confirmed' ? 'green' : 'amber'}>{LABEL_KO[label]}</Badge></td></tr>
          );
        })}
      </tbody></table>

      <h2>업무 시계 <small>현재 {clock.today} (업무 기준일 {clock.asOf})</small></h2>
      <form action={actAdvanceClock} className="inline">{hidden}
        <label>이 날짜로 진행 <input type="date" name="date" defaultValue={clock.today} min={clock.today} required /></label>
        <button type="submit">시계 진행</button>
      </form>
      <p className="meta">되돌릴 수 없습니다. D-14·D-7·D-3 알림과 D-3 에스컬레이션, 기한 경과 처리가 이때 생성됩니다. 처음부터 다시 하려면 초기화하세요.</p>
      <form action={actReset}>{hidden}<button type="submit">전체 초기화 (시계 {clock.asOf}, 26건 재접수)</button></form>

      <h2>실제 작동 / 모의 / 설계 단계</h2>
      <table><tbody>
        <tr><th>실제 작동</th><td>계산, 기준점 판정, 현금 시뮬레이션, 승인 경로, 실효 기한·업무 시계, 상태·이력, 알림·에스컬레이션, 확인 요청 생성, AI 초안과 숫자 대조</td></tr>
        <tr><th>모의 처리</th><td>CEO·대표 결정 입력, 계약 담당·에이전시 회신, 통보 발송</td></tr>
        <tr><th>설계 단계</th><td>확장 C(계약 구조 대안), D(귀속 중복 대사)</td></tr>
      </tbody></table>
    </>
  );
}
