import type { IsoDate } from '../engine/types.js';
import { formatMan } from '../format.js';
import type { Role } from '../workflow/roles.js';
import { CONTRACT_ID, type IntakeService, type ReplyValues } from './service.js';

export type ScenarioName = 'normal' | 'change' | 'shortage' | 'check';
export interface ScenarioReport { scenario: ScenarioName; lines: string[]; facts: Record<string, unknown> }

const IN_BREACH: IsoDate = '2026-08-10'; // 하회 구간(7/21~8/21) 안
const AFTER_BREACH: IsoDate = '2026-09-30'; // 하회 구간 밖

/** 시연 3건(명세 9장). 서비스 공개 메서드만 호출하므로 화면 조작과 같은 순서·같은 결과다. */
export async function runScenario(svc: IntakeService, name: ScenarioName): Promise<ScenarioReport> {
  const lines: string[] = [];
  const facts: Record<string, unknown> = {};
  const say = (s: string) => lines.push(s);

  const openRequest = async (needed = 'cash_outflow_date') =>
    (await svc.getCase(CONTRACT_ID)).requests.find((r) => r.needed === needed && r.status === 'requested')!;
  const route = async (id: string) => (await svc.getCase(id)).item.routeLevel;
  /** 열린 확인 요청에 담당 역할로 회신한다(모의). */
  const replyOpen = async (input: Omit<Parameters<IntakeService['replyInfoRequest']>[1], 'actor'>) => {
    const q = await openRequest();
    await svc.replyInfoRequest(q.id, { ...input, actor: q.ownerRole as Role });
  };
  const submitContract = async () => {
    await svc.confirmFinance(CONTRACT_ID, 'finance');
    await svc.submit(CONTRACT_ID, 'marketing');
  };

  if (name === 'normal') {
    await svc.reset();
    say('업무 기준일 2026-07-01, 기안 25건 + 혜인 전속계약 갱신 접수');
    const v = await svc.listToday();
    const by = (code: string) => v.items.filter((i) => i.issues.includes(code));
    facts.lossCampaigns = [...new Set(by('LOSS').map((i) => i.campaign))].sort();
    facts.executionBeforeDeadline = by('EXECUTION_BEFORE_DEADLINE').length;
    const ceo = v.items.filter((i) => i.routeLevel === 'CEO_BOARD');
    facts.ceoBoard = ceo.length;
    facts.ceoBoardIncludesContract = ceo.some((i) => i.id === CONTRACT_ID);
    facts.boardDate = ceo[0]?.boardDate ?? null;
    facts.masilGroupReport = v.items.filter((i) => i.routeLevel === 'MASIL_CEO_GROUP_REPORT').length;
    facts.hyeinGroup = (await svc.getCase(CONTRACT_ID)).group.map((g) => g.id).sort();
    facts.avaGlowGroup = (await svc.getCase('PLAN-005')).group.map((g) => g.id).sort();
    say(`음수 실질 ROAS 캠페인 ${(facts.lossCampaigns as string[]).join(', ')}`);
    say(`확정 전 집행 예정 ${facts.executionBeforeDeadline}건, CEO/이사회 ${facts.ceoBoard}건(이사회 ${facts.boardDate}), 대표+그룹 보고 ${facts.masilGroupReport}건`);
  }

  if (name === 'change') {
    await svc.reset();
    await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 1_800_000_000 });
    const d18 = await svc.getCase(CONTRACT_ID);
    facts.fee18 = { route: d18.item.routeLevel, penaltyAtRenewal: d18.penalty };
    say(`고정 피 연 18억 원: 경로 ${d18.item.routeLevel}, 갱신 직후 해지 위약금 ${formatMan(d18.penalty!)}`);

    await svc.reset();
    await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
    const d9 = await svc.getCase(CONTRACT_ID);
    facts.fee9 = {
      route: d9.item.routeLevel,
      infoRequest: d9.requests.some((r) => r.needed === 'cash_outflow_date' && r.status === 'requested'),
      simulated: d9.events.find((e) => e.action === 'propose_change')?.simulated === true,
      deferredNote: d9.notes.some((n) => n.includes('금액 판단 유보')),
    };
    say(`고정 피 연 9억 원: 경로 ${d9.item.routeLevel}, 현금 유출일 확인 요청 생성`);
    await replyOpen({
      text: `회신(모의): ${IN_BREACH} 지급`, values: { cashOutflowDate: IN_BREACH }, simulated: true,
    });
    facts.reply0810Route = await route(CONTRACT_ID);
    say(`회신 ${IN_BREACH}(하회 구간 안) → ${facts.reply0810Route}`);

    await svc.reset();
    await svc.proposeContractChange({ actor: 'contract', annualFixedFeeKrw: 900_000_000 });
    await replyOpen({
      text: `회신(모의): ${AFTER_BREACH} 지급`, values: { cashOutflowDate: AFTER_BREACH }, simulated: true,
    });
    facts.reply0930Route = await route(CONTRACT_ID);
    say(`회신 ${AFTER_BREACH}(하회 구간 밖) → ${facts.reply0930Route}`);

    await svc.reset();
    await svc.setScenario('lc45');
    facts.lc45CeoBoard = (await svc.listToday()).items.filter((i) => i.routeLevel === 'CEO_BOARD').length;
    say(`민감도 점검: LC-0001 45일 가정에서 CEO/이사회 상신 ${facts.lc45CeoBoard}건(전속계약뿐)`);
  }

  if (name === 'shortage') {
    const prepare = async () => {
      await svc.reset();
      await submitContract();
      await svc.decide(CONTRACT_ID, 'ceo_board', {
        hold: { needed: 'cash_outflow_date', ownerRole: 'finance', dueDate: '2026-07-08' },
      });
    };
    await prepare();
    const hold = (await svc.getCase(CONTRACT_ID)).requests.find((r) => r.dueDate === '2026-07-08')!;
    facts.holdOwnerAndDue = { ownerRole: hold.ownerRole, dueDate: hold.dueDate };
    say('전속계약 보류: 고정 피 지급 일정 미확인 → 재무에 확인 요청(기한 2026-07-08)');
    const r = await svc.advanceClock('2026-07-14');
    say(`업무 시계 2026-07-14: ${r.raised.map((x) => `${x.caseId}:${x.stage}:${x.kind}`).filter((s) => s.startsWith(CONTRACT_ID)).join(', ')}`);
    facts.escalationOptions = (await svc.getCase(CONTRACT_ID)).escalation;

    const reply = async (label: string, values: ReplyValues | undefined) => {
      await replyOpen({ text: `${label} 회신(모의)`, values, simulated: true });
      const d = await svc.getCase(CONTRACT_ID);
      return { status: d.item.status, route: d.item.routeLevel, inBreach: d.item.inBreach };
    };
    facts.favorable = await reply('유리', { cashOutflowDate: AFTER_BREACH });
    say(`유리한 회신 → ${JSON.stringify(facts.favorable)}`);

    await prepare();
    await svc.advanceClock('2026-07-14');
    facts.unfavorable = await reply('불리', { cashOutflowDate: IN_BREACH });
    say(`불리한 회신 → ${JSON.stringify(facts.unfavorable)}`);

    await prepare();
    await svc.advanceClock('2026-07-14');
    await replyOpen({ text: '지연 회신(모의): 일정 미정', simulated: true });
    const dd = await svc.getCase(CONTRACT_ID);
    facts.delayed = {
      status: dd.item.status,
      requestStatus: dd.requests.find((q) => q.dueDate === '2026-07-08')?.status,
    };
    say(`지연 회신 → ${JSON.stringify(facts.delayed)}`);

    await svc.reset();
    await submitContract();
    await svc.decide(CONTRACT_ID, 'ceo_board', { reject: { reason: '시연: 조건 재검토 필요' } });
    await svc.resubmit(CONTRACT_ID, 'marketing');
    await submitContract(); // 재상신은 재무 확인부터 다시 시작한다
    facts.afterRejectResubmit = (await svc.getCase(CONTRACT_ID)).item.status;
    say(`CEO 거절 → 재상신 → ${facts.afterRejectResubmit}`);

    await svc.reset();
    await svc.confirmFinance('PLAN-001', 'finance');
    await svc.submit('PLAN-001', 'marketing');
    await svc.decide('PLAN-001', 'ceo_board', { reject: { reason: '시연: 조건 재검토 필요' } });
    facts.linkWarning = (await svc.getCase(CONTRACT_ID)).linkWarnings[0]?.message ?? null;
    say(`혜인 기안 PLAN-001만 부결: ${facts.linkWarning}`);
  }

  if (name === 'check') await runCheck(svc, say, facts);

  return { scenario: name, lines, facts };
}

const WON_EOK = formatMan;

/**
 * 상신 전 점검 시연(기준일 7/1, 시계는 움직이지 않는다). 점검은 계산·판정·초안까지이고 상신·승인은 사람이 한다.
 * 정상 / 변경(가정을 바꿔 재점검) / 정보 부족(확인 요청과 회신).
 */
async function runCheck(svc: IntakeService, say: (s: string) => void, facts: Record<string, unknown>): Promise<void> {
  const label = async (id: string) => (await svc.listToday()).items.find((i) => i.id === id)!.checkLabel;
  const LABEL_KO = { waiting_info: '확인 대기', finance_pending: '재무 확인 대기', ready: '상신 준비 완료', submitted: '상신함' } as const;
  const lab = async (id: string) => { const l = await label(id); return l ? LABEL_KO[l] : '-'; };
  const show = async (id: string) => { for (const l of (await svc.getCase(id)).check.lines) say(`  ${l}`); };

  // ---- 1) 정상: PLAN-019(초혜핏 CMP-0005, 집행 9/14, 하회 구간 밖, 실질 ROAS 높음) ----
  await svc.reset();
  say('[정상] PLAN-019 점검(기준일 2026-07-01)');
  const p19 = await svc.getCase('PLAN-019');
  facts.normal = {
    campaign: p19.item.campaign, settlementDate: p19.item.settlementDate, inBreach: p19.item.inBreach, route: p19.item.routeLevel,
    realRoas: p19.check.evidence.realRoas, labelBefore: await label('PLAN-019'),
  };
  await show('PLAN-019');
  say(`  → 점검 결과: 점검 통과, ${await lab('PLAN-019')}`);
  await svc.confirmFinance('PLAN-019', 'finance'); // 기존 상태 기계: 재무가 같은 점검표로 금액 확인 → 상신 가능
  (facts.normal as Record<string, unknown>).labelAfterFinance = await label('PLAN-019');
  say(`  → 재무 확인 후: ${await lab('PLAN-019')}`);
  say('  (마케팅이 확인 칸을 체크하고 상신 버튼을 누름: 상신은 사람이 하고 되돌릴 수 없음)');
  await svc.submit('PLAN-019', 'marketing');
  const after = await svc.getCase('PLAN-019');
  (facts.normal as Record<string, unknown>).labelAfter = await label('PLAN-019');
  (facts.normal as Record<string, unknown>).statusAfter = after.item.status;
  say(`  → 상신 후: ${await lab('PLAN-019')}(${after.item.status}), 결재 ${after.item.routeLabel}`);

  // ---- 2) 변경: PLAN-001(혜인)과 같은 날 마감 전속계약을 함께 보고 가정을 바꿔 재점검 ----
  await svc.reset();
  say('[변경] 혜인 PLAN-001과 전속계약(둘 다 결정 기한 2026-07-17)');
  const both = async () => {
    const out: Record<string, unknown> = {};
    for (const id of ['PLAN-001', 'CONTRACT-INF-001']) {
      const d = await svc.getCase(id);
      out[id] = { route: d.item.routeLevel, realRoas: d.check.evidence.realRoas, influencerRealRoas: d.check.evidence.influencerRealRoas, stillLoss: d.check.evidence.stillLoss };
    }
    return out;
  };
  await show('PLAN-001');
  facts.changeBase = await both();
  const cut = async (sc: Parameters<IntakeService['setScenario']>[0], title: string) => {
    await svc.setScenario(sc);
    const v = await svc.listToday();
    const d = await svc.getCase('PLAN-001');
    const r = { route: d.item.routeLevel, contractRoute: (await svc.getCase('CONTRACT-INF-001')).item.routeLevel, breaches: v.breaches.map((b) => `${b.start}~${b.end}`), ...d.check.evidence };
    say(`  가정 [${title}] → PLAN-001 ${r.route}, 전속계약 ${r.contractRoute}, 하회 ${r.breaches.join(', ') || '없음'}`);
    return r;
  };
  // 반품 원인 분리 보기는 가정 전환이 아니라 평가용 보기다: 판정·경로·하회는 그대로이고 성과 숫자만 나란히 본다.
  const ev = (await svc.getCase('PLAN-001')).check.evidence;
  say(`  보기 [반품 원인 분리, 가정: 오배송·불량은 인플루언서 책임이 아님] → PLAN-001 캠페인 실질 ROAS ${ev.realRoas?.toFixed(2)}→${ev.realRoasDemandOnly?.toFixed(2)}, 혜인 ${ev.influencerRealRoas?.toFixed(2)}→${ev.influencerRealRoasDemandOnly?.toFixed(2)}(${ev.stillLoss ? '여전히 손실' : '손실 아님'}). 경로·하회는 그대로, 회사 손익은 바뀌지 않음`);
  const demand = { route: (await svc.getCase('PLAN-001')).item.routeLevel, stillLoss: ev.stillLoss };
  const ar = await cut('arOverdueExcluded', '연체 매출채권 제외');
  await svc.setScenario('baseline');
  const lc = await cut('lc45', 'LC-0001 45일');
  await svc.setScenario('baseline');
  facts.changeKept = { demandOnly: { route: demand.route, stillLoss: demand.stillLoss }, arOverdueExcluded: { route: ar.route, breaches: ar.breaches } };
  facts.changeChanged = { lc45: { route: lc.route, contractRoute: lc.contractRoute, breaches: lc.breaches } };
  say('  유지: 반품 원인 분리·연체 매출채권 제외에서도 결론(CEO/이사회, 손실)은 그대로 / 변경: LC-0001 45일에서 하회가 사라져 PLAN-001 경로가 바뀜(전속계약 28억은 그대로 CEO/이사회)');

  // ---- 3) 정보 부족: 전속계약 28억 지급일 미확인 ----
  const infoRun = async (date: string) => {
    await svc.reset();
    const before = await lab('CONTRACT-INF-001');
    await svc.confirmFinance('CONTRACT-INF-001', 'finance');
    const asked = await lab('CONTRACT-INF-001');
    const q = (await svc.getCase('CONTRACT-INF-001')).requests.find((r) => r.status === 'requested')!;
    await svc.replyInfoRequest(q.id, { actor: q.ownerRole as Role, text: `회신(모의): ${date} 지급`, values: { cashOutflowDate: date }, simulated: true });
    const d = await svc.getCase('CONTRACT-INF-001');
    return { before, asked, owner: q.ownerRole, needed: q.needed, inBreach: d.item.inBreach, route: d.item.routeLevel, status: d.item.status, after: await lab('CONTRACT-INF-001'), amount: WON_EOK(d.item.amount) };
  };
  await svc.reset();
  say('[정보 부족] 전속계약 28억: 고정 피 지급일 미확인');
  await show('CONTRACT-INF-001');
  const inside = await infoRun('2026-08-10');
  say(`  점검 ${inside.before} → 재무 확인 요청(${inside.owner}, ${inside.needed}) → ${inside.asked} → 모의 회신 2026-08-10: 하회 구간 ${inside.inBreach}, 경로 ${inside.route}, 점검 ${inside.after}`);
  const outside = await infoRun('2026-09-30');
  say(`  점검 ${outside.before} → 재무 확인 요청 → ${outside.asked} → 모의 회신 2026-09-30: 하회 구간 ${outside.inBreach}, 경로 ${outside.route}, 점검 ${outside.after}`);
  say('  주의: 28억은 어느 쪽이든 CEO/이사회 결정입니다. 회신이 바꾸는 것은 하회 구간 해당 여부와 상태(확인 대기 → 재무 확인 전이면 재무 확인 대기, 확인 후면 상신 준비 완료. 이 시연은 재무 확인 뒤 회신하므로 상신 준비 완료)이지 결재자가 아닙니다.');
  facts.infoMissing = { inside, outside };
}
