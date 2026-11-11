import { SCENARIOS, THRESHOLDS } from '../../../src/engine/assumptions.js';
import { getService } from '../../../src/app/instance.js';
import { actAdvanceClock, actReset, actSetScenario } from '../../actions.js';
import { Badge, Flash, LABEL_KO, SCENARIO_LABEL, won } from '../../components.js';

export const dynamic = 'force-dynamic';

const SCENARIO_WHY: Record<string, string> = {
  baseline: '기본값입니다. 연체된 외상 대금은 기준일에 받고 낸다고 보고, LC-0001 대금은 90일 뒤에 받는다고 봅니다.',
  arOverdueExcluded: '기준일 전에 이미 늦어진 외상매출은 못 받는다고 가정해 봅니다.',
  apOverdueExcluded: '기준일 전에 이미 늦어진 외상매입은 내지 않는다고 가정해 봅니다.',
  bothOverdueExcluded: '연체된 외상매출·외상매입을 모두 빼고 계산해 봅니다.',
  lc45: 'LC-0001 대금을 45일 뒤에 받는다고 가정합니다. 재무팀 공식 전망이 왜 다른지 설명할 때만 쓰는 점검용이에요(확인된 조건은 90일).',
};
const FIELD_KO: Record<string, string> = {
  unitsPerOrder: '주문 1건당 판매 수량', channelFeeBasis: '판매 채널 수수료 기준', recoverCostOnRefund: '환불되면 원가·수수료를 돌려받는지',
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
  const [scenario, clock] = [await svc.getScenario(), await svc.getClock()];
  const a = SCENARIOS[scenario];
  const hidden = <input type="hidden" name="back" value="/settings" />;
  return (
    <>
      <Flash error={error} />
      <h1>시계·설정</h1>
      <div className="flash flash-ok intro">시연하거나 점검할 때만 쓰는 화면이에요. 처음 쓰시는 분은 열어 보지 않아도 됩니다.</div>

      <section className="card-block">
        <h2>오늘 날짜 옮기기 <small>(지금: {clock.today})</small></h2>
        <p>시연에서는 실제 날짜 대신 “가상의 오늘”을 씁니다. 날짜를 앞으로 옮기면 기한이 다가오는 건에 알림이 생기고, 기한이 지나면 <strong>자동 확정으로 기록</strong>돼요. 되돌릴 수는 없습니다.</p>
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

      <h2>가정을 바꿔 보기</h2>
      <p>현금 계산에는 자료에 없어서 정한 가정이 들어 있어요. 가정을 바꾸면 현금이 부족해지는 기간이 달라지고, 그에 따라 <strong>누가 승인해야 하는지</strong>도 달라질 수 있습니다. 아직 끝나지 않은 건만 다시 계산돼요.</p>
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
