import { SCENARIOS, THRESHOLDS, type AssumptionSet, type ScenarioId } from '../engine/assumptions.js';
import { addDays, isIsoDate } from '../engine/calendar.js';
import { buildCases, planTotal, type Case } from '../engine/cases.js';
import { simulateCash, type BreachWindow, type CashResult } from '../engine/cash.js';
import { terminationPenalty } from '../engine/contract.js';
import { buildIntake, type IntakeRow } from '../engine/intake.js';
import { ROUTE_LABEL, routeCase, type Route, type RouteLevel } from '../engine/routing.js';
import type { DataRoom, IsoDate } from '../engine/types.js';
import type { AlertRow, Clock, EventRow, InfoRequestRow, Repo } from '../store/repo.js';
import { ESCALATION_OPTIONS, linkWarnings, needsEscalation, stagesDue, type LinkWarning, type Stage } from '../workflow/guard.js';
import { ROLE_LABEL, isRole, type Role } from '../workflow/roles.js';
import { TERMINAL, transition, type Action, type HoldInput, type Status } from '../workflow/status.js';

export const CONTRACT_ID = 'CONTRACT-INF-001';
export interface ContractOverrides { annualFixedFeeKrw?: number; cashOutflowDate?: IsoDate | null }
export type Actor = Role | 'system';
export type Decision = 'approve' | 'reject' | { hold: HoldInput };
export interface ReplyValues { cashOutflowDate?: IsoDate; annualFixedFeeKrw?: number }
export interface Raised { caseId: string; stage: Stage; kind: 'alert' | 'escalation' | 'expired' }

export interface TodayItem {
  id: string; kind: 'plan' | 'contract'; influencerId: string; influencer: string; campaign: string;
  amount: number; scale: '표본' | '풀스케일'; deadline: IsoDate; settlementDate: IsoDate | '';
  effectiveDeadline: IsoDate; daysLeft: number; alertStage: string; status: Status;
  routeLevel: RouteLevel; routeLabel: string; inBreach: '예' | '아니오' | '미확인'; issues: string[];
  nominalRank: number | ''; realRank: number | ''; boardDate: IsoDate | null;
}
export interface TodayView {
  asOf: IsoDate; today: IsoDate; scenario: ScenarioId; assumptionVersion: string;
  breaches: BreachWindow[]; items: TodayItem[]; linkWarnings: LinkWarning[]; openRequests: number;
}
export interface CaseDetail {
  item: TodayItem; row: IntakeRow; reasons: string[]; needsInfo: string[]; events: EventRow[];
  requests: InfoRequestRow[]; group: { id: string; kind: string; status: Status }[]; linkWarnings: LinkWarning[];
  notes: string[]; penalty: number | null; escalation: readonly string[] | null; alerts: AlertRow[];
}

interface Computed {
  a: AssumptionSet; clock: Clock; scenario: ScenarioId; contract: ContractOverrides; cases: Case[];
  routes: Map<string, Route>; cash: CashResult; intake: IntakeRow[];
}

/** 사람 역할이 대신 입력하는 결재·회신은 모의로 표시한다(명세 11장). */
const SIMULATED_ACTORS: ReadonlySet<Actor> = new Set<Actor>(['masil_ceo', 'ceo_board', 'contract']);

export class IntakeService {
  private repo: Repo;
  private room: DataRoom;
  constructor(deps: { repo: Repo; room: DataRoom }) { this.repo = deps.repo; this.room = deps.room; }

  // ---------- 계산 ----------
  private async compute(): Promise<Computed> {
    const clock = await this.repo.getClock();
    if (!clock) throw new Error('NOT_INITIALIZED: reset()을 먼저 호출해야 합니다');
    const scenario = (await this.repo.getSetting<ScenarioId>('scenario')) ?? 'baseline';
    const a = SCENARIOS[scenario];
    const contract = (await this.repo.getSetting<ContractOverrides>('contract')) ?? {};
    const cases = buildCases(this.room, contract);
    const cash = simulateCash(this.room.full, a);
    const total = planTotal(cases);
    const routes = new Map(cases.map((k) => [k.id, routeCase(k, { breaches: cash.breaches, planTotal: total })]));
    return { a, clock, scenario, contract, cases, routes, cash, intake: buildIntake(this.room, a, clock.today, contract) };
  }

  private snapshot(c: Computed, id: string) {
    const r = c.routes.get(id)!;
    return {
      route: r.level, reasons: r.reasons, needsInfo: r.needsInfo, scenario: c.scenario, today: c.clock.today,
      effectiveDeadline: c.cases.find((k) => k.id === id)!.effectiveDeadline,
    };
  }

  private async log(c: Computed, id: string, actor: Actor, action: string, opts: { detail?: unknown; simulated?: boolean } = {}) {
    await this.repo.addEvent({
      caseId: id, businessDate: c.clock.today, actorRole: actor, action, detail: opts.detail,
      snapshot: this.snapshot(c, id), assumptionVersion: c.a.version,
      simulated: opts.simulated ?? SIMULATED_ACTORS.has(actor),
    });
  }

  private async requireState(id: string) {
    const st = await this.repo.getState(id);
    if (!st) throw new Error(`UNKNOWN_CASE: ${id}`);
    return { ...st, status: st.status as Status, routeLevel: st.routeLevel as RouteLevel };
  }

  /** 필요 정보가 남은 건에 열린 확인 요청이 없으면 만든다(담당 재무, 기한 = min(오늘+3일, 실효 기한)). */
  private async ensureInfoRequests(c: Computed, id: string, simulated: boolean) {
    const route = c.routes.get(id)!;
    const open = await this.repo.listInfoRequests({ status: 'requested', caseId: id });
    for (const needed of route.needsInfo) {
      if (open.some((r) => r.needed === needed)) continue;
      const eff = c.cases.find((k) => k.id === id)!.effectiveDeadline;
      let due = addDays(c.clock.today, 3);
      if (due > eff) due = eff;
      if (due < c.clock.today) due = c.clock.today;
      await this.repo.addInfoRequest({ caseId: id, needed, ownerRole: 'finance', dueDate: due, createdDate: c.clock.today, simulated });
    }
  }

  // ---------- 초기화·시계 ----------
  async ensureInitialized(): Promise<void> {
    if (!(await this.repo.getClock())) await this.reset();
  }

  async reset(): Promise<void> {
    await this.repo.migrate();
    await this.repo.resetAll();
    const a = SCENARIOS.baseline;
    await this.repo.setClock({ asOf: a.asOf, today: a.asOf });
    await this.repo.setSetting('scenario', 'baseline');
    await this.repo.setSetting('contract', {});
    const c = await this.compute();
    for (const k of c.cases) {
      await this.repo.upsertState({
        caseId: k.id, status: 'finance_review', routeLevel: c.routes.get(k.id)!.level, updatedBusinessDate: c.clock.today,
      });
      await this.log(c, k.id, 'system', 'received', { simulated: false });
      await this.log(c, k.id, 'system', 'calculated', { simulated: false });
    }
    await this.runGuard(c);
  }

  async getScenario(): Promise<ScenarioId> {
    return (await this.repo.getSetting<ScenarioId>('scenario')) ?? 'baseline';
  }

  async getClock(): Promise<Clock> {
    const c = await this.repo.getClock();
    if (!c) throw new Error('NOT_INITIALIZED');
    return c;
  }

  async advanceClock(to: IsoDate): Promise<{ raised: Raised[] }> {
    if (!isIsoDate(to)) throw new Error(`INVALID_DATE: ${String(to)}`);
    const clock = await this.getClock();
    if (to < clock.today) throw new Error(`CLOCK_BACKWARDS: 업무 시계는 ${clock.today}에서 ${to}로 되돌릴 수 없습니다`);
    if (to === clock.today) return { raised: [] };
    await this.repo.setClock({ ...clock, today: to });
    return { raised: await this.runGuard(await this.compute()) };
  }

  /** 종결되지 않은 건에 단계별 알림·에스컬레이션을 한 번씩 만들고 기한 경과를 처리한다. */
  private async runGuard(c: Computed): Promise<Raised[]> {
    const raised: Raised[] = [];
    const today = c.clock.today;
    for (const st of await this.repo.listStates()) {
      const status = st.status as Status;
      if (TERMINAL.has(status)) continue;
      const k = c.cases.find((x) => x.id === st.caseId)!;
      const stages = stagesDue(today, k.effectiveDeadline);
      if (stages.includes('overdue')) {
        const next = transition({ status, routeLevel: st.routeLevel as RouteLevel }, 'expire', 'system');
        await this.repo.upsertState({ ...st, status: next, updatedBusinessDate: today });
        await this.log(c, st.caseId, 'system', 'expire', {
          detail: { message: '기한 경과(자동 확정)', executesBeforeDeadline: k.executesBeforeDeadline }, simulated: false,
        });
        await this.repo.insertAlertIfAbsent({ caseId: st.caseId, stage: 'overdue', kind: 'expired', businessDate: today });
        raised.push({ caseId: st.caseId, stage: 'overdue', kind: 'expired' });
        continue;
      }
      for (const stage of stages) {
        if (await this.repo.insertAlertIfAbsent({ caseId: st.caseId, stage, kind: 'alert', businessDate: today })) {
          raised.push({ caseId: st.caseId, stage, kind: 'alert' });
        }
      }
      if (stages.includes('D-3') && needsEscalation(status)) {
        const payload = { options: [...ESCALATION_OPTIONS], message: '결정 없이 기한이 지나면 자동 확정(또는 확정 전 집행)됩니다.' };
        if (await this.repo.insertAlertIfAbsent({ caseId: st.caseId, stage: 'D-3', kind: 'escalation', businessDate: today, payload })) {
          raised.push({ caseId: st.caseId, stage: 'D-3', kind: 'escalation' });
        }
      }
    }
    return raised;
  }

  // ---------- 조회 ----------
  private buildItems(c: Computed, statuses: Map<string, { status: Status; routeLevel: RouteLevel }>): TodayItem[] {
    const byId = new Map(c.intake.map((r) => [r.제안ID, r]));
    return c.cases.map((k) => {
      const row = byId.get(k.id)!;
      const st = statuses.get(k.id)!;
      return {
        id: k.id, kind: k.kind, influencerId: k.influencerId, influencer: row.인플루언서, campaign: row.캠페인,
        amount: k.amount, scale: row.금액규모, deadline: k.deadline, settlementDate: row.집행예정일,
        effectiveDeadline: k.effectiveDeadline, daysLeft: row.남은일수, alertStage: row.알림단계,
        status: st.status, routeLevel: st.routeLevel, routeLabel: ROUTE_LABEL[st.routeLevel], inBreach: row.하회구간해당,
        issues: row.이슈 === '' ? [] : row.이슈.split(';'), nominalRank: row.명목순위, realRank: row.실질순위,
        boardDate: st.routeLevel === 'CEO_BOARD' ? THRESHOLDS.boardDate : null,
      };
    }).sort((x, y) => x.effectiveDeadline.localeCompare(y.effectiveDeadline) || x.id.localeCompare(y.id));
  }

  private async statusMap() {
    return new Map((await this.repo.listStates()).map((s) => [s.caseId, { status: s.status as Status, routeLevel: s.routeLevel as RouteLevel }]));
  }

  async listToday(): Promise<TodayView> {
    const c = await this.compute();
    const sm = await this.statusMap();
    return {
      asOf: c.clock.asOf, today: c.clock.today, scenario: c.scenario, assumptionVersion: c.a.version,
      breaches: c.cash.breaches, items: this.buildItems(c, sm),
      linkWarnings: linkWarnings(c.cases, new Map([...sm].map(([k, v]) => [k, v.status]))),
      openRequests: (await this.repo.listInfoRequests({ status: 'requested' })).length,
    };
  }

  async getCase(id: string): Promise<CaseDetail> {
    const c = await this.compute();
    const sm = await this.statusMap();
    const k = c.cases.find((x) => x.id === id);
    if (!k) throw new Error(`UNKNOWN_CASE: ${id}`);
    const item = this.buildItems(c, sm).find((i) => i.id === id)!;
    const route = c.routes.get(id)!;
    const alerts = await this.repo.listAlerts(id);
    const esc = alerts.find((a) => a.kind === 'escalation');
    const notes: string[] = [];
    if (k.kind === 'contract') {
      notes.push('금액 판단 유보: 표본 성과 순위와 고정 피를 곱하지 않고 나란히만 봅니다.');
      if (k.cashOutflowDate === null) notes.push('고정 피 지급 일정(현금 유출일) 미확인: 하회 구간 해당 여부를 판정할 수 없습니다.');
    }
    if (k.executesBeforeDeadline) notes.push(`확정 전 집행 예정: 집행 예정일 ${k.settlementDate}이 확정기한 ${k.deadline}보다 빠릅니다.`);
    return {
      item, row: c.intake.find((r) => r.제안ID === id)!, reasons: route.reasons, needsInfo: route.needsInfo,
      events: await this.repo.listEvents(id), requests: await this.repo.listInfoRequests({ caseId: id }),
      group: c.cases.filter((x) => x.linkGroup === k.linkGroup).map((x) => ({ id: x.id, kind: x.kind, status: sm.get(x.id)!.status })),
      linkWarnings: linkWarnings(c.cases, new Map([...sm].map(([key, v]) => [key, v.status]))).filter((w) => w.influencerId === k.linkGroup),
      notes, penalty: k.kind === 'contract' ? terminationPenalty(k.amount, '2026-09-01') : null,
      escalation: esc ? ESCALATION_OPTIONS : null, alerts,
    };
  }

  // ---------- 상태 변경 ----------
  private async act(id: string, actor: Actor, action: Action, opts: { hold?: HoldInput; rejudge?: boolean } = {}) {
    const c = await this.compute();
    const st = await this.requireState(id);
    const next = transition(st, action, actor, { today: c.clock.today, hold: opts.hold });
    const level = opts.rejudge ? c.routes.get(id)!.level : st.routeLevel;
    await this.repo.upsertState({ caseId: id, status: next, routeLevel: level, updatedBusinessDate: c.clock.today });
    await this.log(c, id, actor, action, { detail: opts.hold });
    return c;
  }

  async confirmFinance(id: string, actor: Actor): Promise<void> {
    const c = await this.act(id, actor, 'confirm_finance', { rejudge: true });
    await this.ensureInfoRequests(c, id, false);
  }
  async submit(id: string, actor: Actor): Promise<void> { await this.act(id, actor, 'submit'); }
  async resubmit(id: string, actor: Actor): Promise<void> { await this.act(id, actor, 'resubmit'); }
  async close(id: string, actor: Actor): Promise<void> { await this.act(id, actor, 'close'); }

  async decide(id: string, actor: Actor, decision: Decision): Promise<void> {
    if (decision === 'approve' || decision === 'reject') { await this.act(id, actor, decision); return; }
    const c = await this.act(id, actor, 'hold', { hold: decision.hold });
    await this.repo.addInfoRequest({
      caseId: id, needed: decision.hold.needed, ownerRole: decision.hold.ownerRole, dueDate: decision.hold.dueDate,
      createdDate: c.clock.today, simulated: SIMULATED_ACTORS.has(actor),
    });
  }

  // ---------- 전속계약 조건·회신 ----------
  private async applyContract(patch: ContractOverrides): Promise<void> {
    const cur = (await this.repo.getSetting<ContractOverrides>('contract')) ?? {};
    await this.repo.setSetting('contract', { ...cur, ...patch });
  }

  /** 조건이 바뀐 뒤 종결되지 않은 건의 경로를 다시 판정한다. 바뀐 건 id 목록을 돌려준다. */
  private async rejudge(c: Computed, only?: string): Promise<string[]> {
    const changed: string[] = [];
    for (const st of await this.repo.listStates()) {
      if ((only && st.caseId !== only) || TERMINAL.has(st.status as Status)) continue;
      const level = c.routes.get(st.caseId)!.level;
      if (level !== st.routeLevel) {
        await this.repo.upsertState({ ...st, routeLevel: level, updatedBusinessDate: c.clock.today });
        changed.push(st.caseId);
      }
    }
    return changed;
  }

  async proposeContractChange(input: { annualFixedFeeKrw: number; cashOutflowDate?: IsoDate | null }): Promise<void> {
    if (!Number.isInteger(input.annualFixedFeeKrw) || input.annualFixedFeeKrw <= 0) throw new Error('INVALID_REPLY: 고정 피는 양의 정수(원)여야 합니다');
    if (input.cashOutflowDate != null && !isIsoDate(input.cashOutflowDate)) throw new Error('INVALID_REPLY: 현금 유출일이 날짜가 아닙니다');
    const st = await this.requireState(CONTRACT_ID);
    if (TERMINAL.has(st.status)) throw new Error(`CASE_CLOSED: ${CONTRACT_ID}은(는) ${st.status} 상태입니다`);
    const before = await this.compute();
    await this.applyContract({
      annualFixedFeeKrw: input.annualFixedFeeKrw,
      ...(input.cashOutflowDate !== undefined ? { cashOutflowDate: input.cashOutflowDate } : {}),
    });
    const c = await this.compute();
    await this.rejudge(c, CONTRACT_ID);
    await this.log(c, CONTRACT_ID, 'contract', 'propose_change', {
      simulated: true,
      detail: {
        fromFeeKrw: before.cases.find((k) => k.id === CONTRACT_ID)!.amount, toFeeKrw: input.annualFixedFeeKrw,
        fromRoute: before.routes.get(CONTRACT_ID)!.level, toRoute: c.routes.get(CONTRACT_ID)!.level,
        penaltyAtRenewal: terminationPenalty(input.annualFixedFeeKrw, '2026-09-01'),
      },
    });
    await this.ensureInfoRequests(c, CONTRACT_ID, true);
  }

  async replyInfoRequest(requestId: number, input: { text: string; values?: ReplyValues; simulated: boolean }): Promise<void> {
    const req = await this.repo.getInfoRequest(requestId);
    if (!req) throw new Error(`UNKNOWN_REQUEST: ${requestId}`);
    if (req.status !== 'requested') throw new Error(`REQUEST_NOT_OPEN: ${requestId}은(는) ${req.status} 상태`);
    const v = input.values ?? {};
    if (v.cashOutflowDate !== undefined && !isIsoDate(v.cashOutflowDate)) throw new Error('INVALID_REPLY: 현금 유출일이 날짜가 아닙니다');
    if (v.annualFixedFeeKrw !== undefined && (!Number.isInteger(v.annualFixedFeeKrw) || v.annualFixedFeeKrw <= 0)) {
      throw new Error('INVALID_REPLY: 고정 피는 양의 정수(원)여야 합니다');
    }
    const hasValues = v.cashOutflowDate !== undefined || v.annualFixedFeeKrw !== undefined;
    const c0 = await this.compute();
    if (!hasValues) {
      await this.repo.updateInfoRequest(requestId, { replyText: input.text, simulated: input.simulated });
      await this.log(c0, req.caseId, req.ownerRole as Actor, 'reply_pending', { simulated: input.simulated, detail: { text: input.text } });
      return;
    }
    if (req.caseId === CONTRACT_ID) {
      await this.applyContract({
        ...(v.cashOutflowDate !== undefined ? { cashOutflowDate: v.cashOutflowDate } : {}),
        ...(v.annualFixedFeeKrw !== undefined ? { annualFixedFeeKrw: v.annualFixedFeeKrw } : {}),
      });
    }
    await this.repo.updateInfoRequest(requestId, {
      status: 'replied', replyText: input.text, replyValues: v, repliedDate: c0.clock.today, simulated: input.simulated,
    });
    for (const o of await this.repo.listInfoRequests({ status: 'requested', caseId: req.caseId })) {
      if (o.id !== requestId && o.needed === req.needed) await this.repo.updateInfoRequest(o.id, { status: 'closed' });
    }
    const c = await this.compute();
    const st = await this.requireState(req.caseId);
    if (st.status === 'on_hold') {
      const owner: Actor = isRole(req.ownerRole) ? req.ownerRole : 'finance';
      const next = transition(st, 'reply', owner);
      await this.repo.upsertState({ caseId: st.caseId, status: next, routeLevel: c.routes.get(st.caseId)!.level, updatedBusinessDate: c.clock.today });
    } else {
      await this.rejudge(c, st.caseId);
    }
    await this.log(c, req.caseId, isRole(req.ownerRole) ? req.ownerRole : 'finance', 'reply', {
      simulated: input.simulated, detail: { values: v, text: input.text, owner: ROLE_LABEL[req.ownerRole as Role] ?? req.ownerRole },
    });
    await this.ensureInfoRequests(c, req.caseId, input.simulated);
  }

  async setScenario(id: ScenarioId): Promise<void> {
    if (!(id in SCENARIOS)) throw new Error(`UNKNOWN_SCENARIO: ${id}`);
    const prev = (await this.repo.getSetting<ScenarioId>('scenario')) ?? 'baseline';
    if (prev === id) return;
    await this.repo.setSetting('scenario', id);
    const c = await this.compute();
    for (const caseId of await this.rejudge(c)) {
      await this.log(c, caseId, 'system', 'scenario_change', {
        simulated: false,
        detail: { from: prev, to: id, reason: `scenario ${prev} → ${id}`, toRoute: c.routes.get(caseId)!.level },
      });
    }
  }
}
