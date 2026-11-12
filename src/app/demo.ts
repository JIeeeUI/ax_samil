import type { IsoDate } from '../engine/types.js';
import type { Role } from '../workflow/roles.js';
import { CONTRACT_ID, type IntakeService, type ReplyValues } from './service.js';

export type ScenarioName = 'normal' | 'change' | 'shortage';
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
    say(`고정 피 연 18억 원: 경로 ${d18.item.routeLevel}, 갱신 직후 해지 위약금 ${d18.penalty}원`);

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
    await svc.decide(CONTRACT_ID, 'ceo_board', 'reject');
    await svc.resubmit(CONTRACT_ID, 'marketing');
    facts.afterRejectResubmit = (await svc.getCase(CONTRACT_ID)).item.status;
    say(`CEO 거절 → 재상신 → ${facts.afterRejectResubmit}`);

    await svc.reset();
    await svc.confirmFinance('PLAN-001', 'finance');
    await svc.submit('PLAN-001', 'marketing');
    await svc.decide('PLAN-001', 'ceo_board', 'reject');
    facts.linkWarning = (await svc.getCase(CONTRACT_ID)).linkWarnings[0]?.message ?? null;
    say(`혜인 기안 PLAN-001만 부결: ${facts.linkWarning}`);
  }

  return { scenario: name, lines, facts };
}
