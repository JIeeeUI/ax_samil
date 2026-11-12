import { SCENARIOS, THRESHOLDS, type AssumptionSet, type ScenarioId } from '../engine/assumptions.js';
import { addDays, daysBetween, isIsoDate } from '../engine/calendar.js';
import { buildCases, planTotal, type Case } from '../engine/cases.js';
import { simulateCash, type BreachWindow, type CashResult } from '../engine/cash.js';
import { terminationPenalty } from '../engine/contract.js';
import { buildIntake, type IntakeRow } from '../engine/intake.js';
import { ROUTE_LABEL, routeCase, type Route, type RouteLevel } from '../engine/routing.js';
import type { DataRoom, IsoDate } from '../engine/types.js';
import type { AlertRow, Clock, EventRow, InfoRequestRow, Repo, ReviewRow } from '../store/repo.js';
import { ALERT_PLANS, MESSAGE_TEXT, recipientsFor, type AlertPlanId } from '../workflow/alertPlan.js';
import { ESCALATION_OPTIONS, linkWarnings, needsEscalation, stagesDue, type LinkWarning } from '../workflow/guard.js';
import { canChangeContract, canReply, defaultOwnerFor, replyKeysFor } from '../workflow/ownership.js';
import { ROLE_LABEL, isRole, type Role } from '../workflow/roles.js';
import { TERMINAL, transition, type Action, type HoldInput, type Status } from '../workflow/status.js';

export const CONTRACT_ID = 'CONTRACT-INF-001';
export interface ContractOverrides { annualFixedFeeKrw?: number; cashOutflowDate?: IsoDate | null }
export type Actor = Role | 'system';
export type Decision = 'approve' | { reject: { reason: string } } | { hold: HoldInput };
export interface Rejection { reason: string; actor: string; date: IsoDate; stage: 'final' | 'primary' }
export interface ReplyValues { cashOutflowDate?: IsoDate; annualFixedFeeKrw?: number }
export interface Raised { caseId: string; stage: string; kind: 'alert' | 'escalation' | 'expired' | 'parallel' | 'warning' }

/** 화면에서 바꿀 수 있는 [가정] 설정값. 기본은 1단계 결재(twoStage 꺼짐). */
export interface Config { twoStage: boolean; urgentDays: number; holdCapDays: number; alertPlan: AlertPlanId }
export const DEFAULT_CONFIG: Config = { twoStage: false, urgentDays: 10, holdCapDays: 3, alertPlan: 'current' };

export interface ReviewView {
  state: ReviewRow['state']; parallel: boolean; parallelDate: IsoDate | null; holdDue: IsoDate | null;
  /** 1차 보류 기한 상한(실효 결정 기한 − 상한 일수) */
  holdCapDate: IsoDate; canHold: boolean; urgentDays: number;
}
export interface PlanStageStatus {
  stage: string; daysBefore: number; kind: 'alert' | 'escalation'; triggerDate: IsoDate;
  state: 'sent' | 'passed' | 'scheduled' | 'due' | 'not_applicable';
}

export interface TodayItem {
  id: string; kind: 'plan' | 'contract'; influencerId: string; influencer: string; campaign: string;
  amount: number; scale: '표본' | '풀스케일'; deadline: IsoDate; settlementDate: IsoDate | '';
  effectiveDeadline: IsoDate; daysLeft: number; alertStage: string; status: Status;
  routeLevel: RouteLevel; routeLabel: string; /** 성과 피 포함 여부 미확인으로 경로가 잠정인 건 */ provisional: boolean; /** 열린 확인 요청의 담당 역할("내 차례" 판단용) */ openRequestOwners: Role[]; /** 1차/2차 결재를 켰고 1차 대표 검토가 끝나기 전(병행 상신 전)인 건 */ primaryPending: boolean; inBreach: '예' | '아니오' | '미확인'; issues: string[];
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
  /** 1차/2차 결재를 켠 CEO/이사회 경로 건에만 값이 있다 */
  review: ReviewView | null;
  /** 거절된 상태일 때 마지막 거절 사유 */
  rejection: Rejection | null;
}

interface Computed {
  a: AssumptionSet; clock: Clock; scenario: ScenarioId; contract: ContractOverrides; cases: Case[];
  routes: Map<string, Route>; cash: CashResult; intake: IntakeRow[];
}

/** 사람 역할이 대신 입력하는 결재·회신은 모의로 표시한다(명세 11장). */
const SIMULATED_ACTORS: ReadonlySet<Actor> = new Set<Actor>(['masil_ceo', 'ceo_board', 'contract']);

function requireReason(reason: string | undefined): void {
  if (typeof reason !== 'string' || reason.trim() === '') throw new Error('REASON_REQUIRED: 거절 사유를 입력해야 합니다');
}

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

  /** 필요 정보가 남은 건에 열린 확인 요청이 없으면 만든다(담당 = 주제별로 정보를 가진 부서, 기한 = min(오늘+3일, 실효 기한)). */
  private async ensureInfoRequests(c: Computed, id: string, simulated: boolean) {
    const route = c.routes.get(id)!;
    const all = await this.repo.listInfoRequests({ caseId: id });
    for (const needed of route.needsInfo) {
      // 열려 있거나 이미 회신 완료된 요청은 다시 만들지 않는다(값이 없는 확인 사항이 계속 되살아나지 않게).
      if (all.some((r) => r.needed === needed && (r.status === 'requested' || r.status === 'replied'))) continue;
      const eff = c.cases.find((k) => k.id === id)!.effectiveDeadline;
      let due = addDays(c.clock.today, 3);
      if (due > eff) due = eff;
      if (due < c.clock.today) due = c.clock.today;
      await this.repo.addInfoRequest({ caseId: id, needed, ownerRole: defaultOwnerFor(needed), dueDate: due, createdDate: c.clock.today, simulated });
    }
  }

  // ---------- 초기화·시계 ----------
  async ensureInitialized(): Promise<void> {
    // 시계만 있고 건이 없으면 초기화가 도중에 끊긴 것이므로 다시 시작한다.
    if (!(await this.repo.getClock()) || (await this.repo.listStates()).length === 0) await this.reset();
  }

  async reset(): Promise<void> {
    await this.repo.migrate();
    await this.repo.resetAll();
    const a = SCENARIOS.baseline;
    await this.repo.setClock({ asOf: a.asOf, today: a.asOf });
    await this.repo.setSetting('scenario', 'baseline');
    await this.repo.setSetting('contract', {});
    await this.repo.setSetting('alertPlanActivatedOn', a.asOf);
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
    // 같은 날 재호출도 가드를 다시 돌린다(알림·기한 경과 처리는 멱등이라 중복되지 않고, 도중 실패한 날의 처리를 이어 준다).
    if (to !== clock.today) await this.repo.setClock({ ...clock, today: to });
    return { raised: await this.runGuard(await this.compute()) };
  }

  /** 종결되지 않은 건에 단계별 알림·에스컬레이션을 한 번씩 만들고 기한 경과를 처리한다. */
  private async runGuard(c: Computed): Promise<Raised[]> {
    const raised: Raised[] = [];
    const today = c.clock.today;
    const cfg = await this.getConfig();
    const activated = (await this.repo.getSetting<IsoDate>('alertPlanActivatedOn')) ?? c.clock.asOf;
    for (const st of await this.repo.listStates()) {
      const status = st.status as Status;
      if (TERMINAL.has(status)) continue;
      const k = c.cases.find((x) => x.id === st.caseId)!;
      const stages = stagesDue(today, k.effectiveDeadline);
      if (stages.includes('overdue')) {
        const next = transition({ status, routeLevel: st.routeLevel as RouteLevel }, 'expire', 'system');
        if (!(await this.repo.transitionState(st.caseId, st.status, { status: next, routeLevel: st.routeLevel, updatedBusinessDate: today }))) continue;
        await this.closeOpenRequests(st.caseId);
        await this.log(c, st.caseId, 'system', 'expire', {
          detail: { message: '기한 경과(자동 확정)', executesBeforeDeadline: k.executesBeforeDeadline }, simulated: false,
        });
        await this.repo.insertAlertIfAbsent({ caseId: st.caseId, stage: 'overdue', kind: 'expired', businessDate: today });
        raised.push({ caseId: st.caseId, stage: 'overdue', kind: 'expired' });
        continue;
      }
      raised.push(...(await this.runPlan(c, cfg, activated, st, k)));
    }
    return raised;
  }

  // ---------- 조회 ----------
  private buildItems(
    c: Computed, statuses: Map<string, { status: Status; routeLevel: RouteLevel }>, reviews: Map<string, ReviewRow>, twoStage: boolean,
    owners: Map<string, Role[]>,
  ): TodayItem[] {
    const byId = new Map(c.intake.map((r) => [r.제안ID, r]));
    return c.cases.map((k) => {
      const row = byId.get(k.id)!;
      const st = statuses.get(k.id)!;
      return {
        id: k.id, kind: k.kind, influencerId: k.influencerId, influencer: row.인플루언서, campaign: row.캠페인,
        amount: k.amount, scale: row.금액규모, deadline: k.deadline, settlementDate: row.집행예정일,
        effectiveDeadline: k.effectiveDeadline, daysLeft: row.남은일수, alertStage: row.알림단계,
        status: st.status, routeLevel: st.routeLevel, routeLabel: ROUTE_LABEL[st.routeLevel],
        openRequestOwners: owners.get(k.id) ?? [],
        primaryPending: twoStage && st.routeLevel === 'CEO_BOARD' && st.status === 'submitted' && (() => {
          const rv = reviews.get(k.id);
          return (!rv || rv.state === 'pending' || rv.state === 'held') && !(rv?.parallel);
        })(),
        provisional: !TERMINAL.has(st.status) && c.routes.get(k.id)!.needsInfo.includes('performance_fee_terms'), inBreach: row.하회구간해당,
        issues: row.이슈 === '' ? [] : row.이슈.split(';'), nominalRank: row.명목순위, realRank: row.실질순위,
        boardDate: st.routeLevel === 'CEO_BOARD' ? THRESHOLDS.boardDate : null,
      };
    }).sort((x, y) => x.effectiveDeadline.localeCompare(y.effectiveDeadline) || x.id.localeCompare(y.id));
  }

  /** 건별로 열린 확인 요청의 담당 역할(중복 제거) */
  private async ownerMap(): Promise<Map<string, Role[]>> {
    const m = new Map<string, Role[]>();
    for (const q of await this.repo.listInfoRequests({ status: 'requested' })) {
      if (!isRole(q.ownerRole)) continue;
      const cur = m.get(q.caseId) ?? [];
      if (!cur.includes(q.ownerRole)) cur.push(q.ownerRole);
      m.set(q.caseId, cur);
    }
    return m;
  }

  private async reviewMap() {
    return new Map((await this.repo.listReviews()).map((r) => [r.caseId, r]));
  }

  private async statusMap() {
    return new Map((await this.repo.listStates()).map((s) => [s.caseId, { status: s.status as Status, routeLevel: s.routeLevel as RouteLevel }]));
  }

  async listToday(): Promise<TodayView> {
    const c = await this.compute();
    const sm = await this.statusMap();
    return {
      asOf: c.clock.asOf, today: c.clock.today, scenario: c.scenario, assumptionVersion: c.a.version,
      breaches: c.cash.breaches, items: this.buildItems(c, sm, await this.reviewMap(), (await this.getConfig()).twoStage, await this.ownerMap()),
      linkWarnings: linkWarnings(c.cases, new Map([...sm].map(([k, v]) => [k, v.status]))),
      openRequests: (await this.repo.listInfoRequests({ status: 'requested' })).length,
    };
  }

  async getCase(id: string): Promise<CaseDetail> {
    const c = await this.compute();
    const sm = await this.statusMap();
    const k = c.cases.find((x) => x.id === id);
    if (!k) throw new Error(`UNKNOWN_CASE: ${id}`);
    const item = this.buildItems(c, sm, await this.reviewMap(), (await this.getConfig()).twoStage, await this.ownerMap()).find((i) => i.id === id)!;
    const route = c.routes.get(id)!;
    const events = await this.repo.listEvents(id);
    // 종결된 건은 결정 당시의 근거를 보여 준다(이후 가정이 바뀌어도 화면이 모순되지 않게).
    const frozen = TERMINAL.has(item.status)
      ? [...events].reverse().map((e) => e.snapshot as { reasons?: string[] } | null).find((sn) => sn?.reasons)
      : undefined;
    const alerts = await this.repo.listAlerts(id);
    const esc = alerts.find((a) => a.kind === 'escalation');
    const notes: string[] = [];
    if (k.kind === 'contract') {
      notes.push('금액 판단 유보: 표본 성과 순위와 고정 피를 곱하지 않고 나란히만 봅니다.');
      if (k.cashOutflowDate === null) notes.push('고정 피 지급 일정(현금 유출일) 미확인: 하회 구간 해당 여부를 판정할 수 없습니다.');
    }
    if (item.provisional) notes.push('잠정 경로: 성과 피를 포함하면 연 10억 원을 넘을 수 있는지 확인되지 않았습니다. 지금은 고정 피 기준으로 잠정 판정했고, 성과 피 조건을 확인한 뒤 확정해야 합니다.');
    if (k.executesBeforeDeadline) notes.push(`확정 전 집행 예정: 집행 예정일 ${k.settlementDate}이 확정기한 ${k.deadline}보다 빠릅니다.`);
    return {
      item, row: c.intake.find((r) => r.제안ID === id)!, reasons: frozen?.reasons ?? route.reasons,
      needsInfo: frozen ? [] : route.needsInfo, events, requests: await this.repo.listInfoRequests({ caseId: id }),
      group: c.cases.filter((x) => x.linkGroup === k.linkGroup).map((x) => ({ id: x.id, kind: x.kind, status: sm.get(x.id)!.status })),
      linkWarnings: linkWarnings(c.cases, new Map([...sm].map(([key, v]) => [key, v.status]))).filter((w) => w.influencerId === k.linkGroup),
      notes, penalty: k.kind === 'contract' ? terminationPenalty(k.amount, '2026-09-01') : null,
      escalation: esc ? ESCALATION_OPTIONS : null, alerts,
      review: await this.reviewView(c, id, sm.get(id)!.routeLevel),
      rejection: item.status === 'rejected' ? this.lastRejection(events) : null,
    };
  }

  private lastRejection(events: EventRow[]): Rejection | null {
    const e = [...events].reverse().find((x) => x.action === 'reject' || x.action === 'primary_return');
    if (!e) return null;
    const reason = (e.detail as { reason?: string } | null)?.reason ?? '';
    return { reason, actor: e.actor_role, date: e.business_date, stage: e.action === 'reject' ? 'final' : 'primary' };
  }

  /** 종결된 건에 남은 열린 확인 요청을 닫는다. */
  private async closeOpenRequests(caseId: string): Promise<void> {
    for (const q of await this.repo.listInfoRequests({ status: 'requested', caseId })) {
      await this.repo.updateInfoRequest(q.id, { status: 'closed' });
    }
  }

  // ---------- 상태 변경 ----------
  private async act(id: string, actor: Actor, action: Action, opts: { hold?: HoldInput; rejudge?: boolean; detail?: unknown } = {}) {
    const c = await this.compute();
    const st = await this.requireState(id);
    const next = transition(st, action, actor, { today: c.clock.today, hold: opts.hold });
    const level = opts.rejudge ? c.routes.get(id)!.level : st.routeLevel;
    const ok = await this.repo.transitionState(id, st.status, { status: next, routeLevel: level, updatedBusinessDate: c.clock.today });
    if (!ok) throw new Error(`INVALID_TRANSITION: ${id}: 방금 다른 요청으로 이미 처리되었습니다(${action})`);
    if (TERMINAL.has(next)) await this.closeOpenRequests(id);
    await this.log(c, id, actor, action, { detail: opts.detail ?? opts.hold });
    return c;
  }

  async confirmFinance(id: string, actor: Actor): Promise<void> {
    const c = await this.act(id, actor, 'confirm_finance', { rejudge: true });
    await this.ensureInfoRequests(c, id, false);
  }
  async submit(id: string, actor: Actor): Promise<void> {
    await this.act(id, actor, 'submit');
    await this.sweepReview();
  }
  async resubmit(id: string, actor: Actor): Promise<void> {
    await this.act(id, actor, 'resubmit');
    if (await this.repo.getReview(id)) {
      await this.repo.saveReview({ caseId: id, state: 'pending', parallel: false, parallelDate: null, holdDue: null, holdRequestId: null });
    }
    await this.sweepReview();
  }
  async close(id: string, actor: Actor): Promise<void> { await this.act(id, actor, 'close'); }

  async decide(id: string, actor: Actor, decision: Decision): Promise<void> {
    if (typeof decision !== 'string' && 'reject' in decision) requireReason(decision.reject.reason);
    // 1차/2차를 켠 CEO/이사회 경로: CEO는 2차 요청(1차 상신 또는 병행 상신)이 있어야 결정한다.
    let openFirstStage: ReviewRow | null = null;
    if (actor === 'ceo_board' && (await this.getConfig()).twoStage) {
      const st = await this.requireState(id);
      if (st.routeLevel === 'CEO_BOARD' && st.status === 'submitted') {
        const rv = await this.reviewOrDefault(id);
        const open = rv.state === 'pending' || rv.state === 'held';
        if (open && !rv.parallel) throw new Error('SECOND_STAGE_NOT_REQUESTED: 1차 대표 검토가 끝나지 않았습니다(긴급 병행 상신 전)');
        if (open) openFirstStage = rv;
      }
    }
    await this.decideCore(id, actor, decision);
    // CEO가 승인·거절로 먼저 결정했으면 1차는 "병행 결정"으로 닫는다(보류는 결정이 아니라 1차를 닫지 않는다).
    if (openFirstStage && !(typeof decision !== 'string' && 'hold' in decision)) {
      const cur = await this.repo.getReview(id);
      const closed = await this.repo.claimReview(id, { states: ['pending', 'held'] }, { state: 'closed_parallel', holdDue: null, holdRequestId: null });
      if (closed) {
        if (cur?.holdRequestId != null) await this.repo.updateInfoRequest(cur.holdRequestId, { status: 'closed' });
        await this.log(await this.compute(), id, 'system', 'primary_closed_parallel', { simulated: false, detail: { primary: openFirstStage.state } });
      }
    }
  }

  private async decideCore(id: string, actor: Actor, decision: Decision): Promise<void> {
    if (decision === 'approve') { await this.act(id, actor, 'approve'); return; }
    if ('reject' in decision) {
      // 거절하면 그 건의 열린 확인 요청은 닫는다. 재상신 때 필요한 것만 다시 만든다.
      await this.act(id, actor, 'reject', { detail: { reason: decision.reject.reason.trim() } });
      await this.closeOpenRequests(id);
      return;
    }
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
        await this.repo.deleteReview(st.caseId); // 경로가 바뀌면 낡은 1차 검토 행을 버린다(1차를 건너뛰지 않게)
        changed.push(st.caseId);
      }
    }
    return changed;
  }

  /** 에이전시의 고정 피 조건 변경 제안(모의 입력). 계약 담당과 결재 역할만 입력한다. 현금 유출일은 확인 요청 회신으로만 바뀐다. */
  async proposeContractChange(input: { actor: Actor; annualFixedFeeKrw: number }): Promise<void> {
    if (!canChangeContract(input.actor)) throw new Error(`ROLE_NOT_ALLOWED: 계약 조건 변경은 계약 담당 또는 결재자만 입력할 수 있습니다(${input.actor})`);
    if (!Number.isInteger(input.annualFixedFeeKrw) || input.annualFixedFeeKrw <= 0) throw new Error('INVALID_REPLY: 고정 피는 양의 정수(원)여야 합니다');
    const st = await this.requireState(CONTRACT_ID);
    if (TERMINAL.has(st.status)) throw new Error(`CASE_CLOSED: ${CONTRACT_ID}: 현재 상태 ${st.status}`);
    const before = await this.compute();
    await this.applyContract({ annualFixedFeeKrw: input.annualFixedFeeKrw });
    const c = await this.compute();
    await this.rejudge(c, CONTRACT_ID);
    await this.log(c, CONTRACT_ID, input.actor, 'propose_change', {
      simulated: true,
      detail: {
        fromFeeKrw: before.cases.find((k) => k.id === CONTRACT_ID)!.amount, toFeeKrw: input.annualFixedFeeKrw,
        fromRoute: before.routes.get(CONTRACT_ID)!.level, toRoute: c.routes.get(CONTRACT_ID)!.level,
        penaltyAtRenewal: terminationPenalty(input.annualFixedFeeKrw, '2026-09-01'),
      },
    });
    await this.ensureInfoRequests(c, CONTRACT_ID, true);
  }

  async replyInfoRequest(requestId: number, input: { actor: Actor; text: string; values?: ReplyValues; simulated: boolean; resolved?: boolean }): Promise<void> {
    const req = await this.repo.getInfoRequest(requestId);
    if (!req) throw new Error(`UNKNOWN_REQUEST: ${requestId}`);
    if (req.status !== 'requested') throw new Error(`REQUEST_NOT_OPEN: 요청 ${requestId}: 현재 상태 ${req.status}`);
    // 회신은 담당 역할과 결재 역할(대표·CEO/이사회, 대신 입력)만 입력할 수 있다 [교육용 가정].
    if (!canReply(input.actor, req.ownerRole)) {
      const owner = isRole(req.ownerRole) ? ROLE_LABEL[req.ownerRole] : req.ownerRole;
      throw new Error(`ROLE_NOT_ALLOWED: 이 확인 요청은 ${owner}(또는 결재자)만 회신할 수 있습니다(${input.actor})`);
    }
    const caseState = await this.requireState(req.caseId);
    if (TERMINAL.has(caseState.status)) throw new Error(`CASE_CLOSED: ${req.caseId}: 현재 상태 ${caseState.status}라 회신을 반영할 수 없습니다`);
    const v = input.values ?? {};
    // 회신 값은 그 요청의 주제에 속한 것만 받는다(다른 부서가 담당하는 계약 조건을 바꾸지 못하게).
    const given = Object.entries(v).filter(([, x]) => x !== undefined).map(([k]) => k);
    const stray = given.filter((k) => !replyKeysFor(req.needed).includes(k));
    if (stray.length > 0) throw new Error(`INVALID_REPLY: "${req.needed}" 요청은 ${stray.join(', ')} 값을 받을 수 없습니다`);
    if (v.cashOutflowDate !== undefined && !isIsoDate(v.cashOutflowDate)) throw new Error('INVALID_REPLY: 현금 유출일이 날짜가 아닙니다');
    if (v.annualFixedFeeKrw !== undefined && (!Number.isInteger(v.annualFixedFeeKrw) || v.annualFixedFeeKrw <= 0)) {
      throw new Error('INVALID_REPLY: 고정 피는 양의 정수(원)여야 합니다');
    }
    const hasValues = v.cashOutflowDate !== undefined || v.annualFixedFeeKrw !== undefined;
    const c0 = await this.compute();
    if (!hasValues && input.resolved) {
      // 구조화 값이 필요 없는 요청(예: 추가 자료)은 회신 완료로 풀어 준다.
      await this.repo.updateInfoRequest(requestId, { status: 'replied', replyText: input.text, repliedDate: c0.clock.today, simulated: input.simulated });
      await this.releasePrimaryHold(c0, req.caseId, requestId);
      const st0 = await this.requireState(req.caseId);
      const othersOpen0 = (await this.repo.listInfoRequests({ status: 'requested', caseId: req.caseId })).some((o) => o.id !== requestId);
      if (st0.status === 'on_hold' && !othersOpen0) {
        const next = transition(st0, 'reply', input.actor);
        await this.repo.transitionState(req.caseId, 'on_hold', { status: next, routeLevel: c0.routes.get(req.caseId)!.level, updatedBusinessDate: c0.clock.today });
      }
      await this.log(c0, req.caseId, input.actor, 'reply', {
        simulated: input.simulated, detail: { resolved: true, text: input.text },
      });
      return;
    }
    if (!hasValues) {
      await this.repo.updateInfoRequest(requestId, { replyText: input.text, simulated: input.simulated });
      await this.log(c0, req.caseId, input.actor, 'reply_pending', { simulated: input.simulated, detail: { text: input.text } });
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
    await this.releasePrimaryHold(c, req.caseId, requestId);
    const st = await this.requireState(req.caseId);
    const othersOpen = (await this.repo.listInfoRequests({ status: 'requested', caseId: req.caseId })).some((o) => o.id !== requestId);
    if (st.status === 'on_hold' && !othersOpen) {
      const next = transition(st, 'reply', input.actor);
      await this.repo.upsertState({ caseId: st.caseId, status: next, routeLevel: c.routes.get(st.caseId)!.level, updatedBusinessDate: c.clock.today });
    } else {
      await this.rejudge(c, st.caseId);
    }
    await this.log(c, req.caseId, input.actor, 'reply', {
      simulated: input.simulated, detail: { values: v, text: input.text, owner: ROLE_LABEL[req.ownerRole as Role] ?? req.ownerRole },
    });
    await this.ensureInfoRequests(c, req.caseId, input.simulated);
  }

  // ---------- 설정 ----------
  async getConfig(): Promise<Config> {
    return { ...DEFAULT_CONFIG, ...((await this.repo.getSetting<Partial<Config>>('config')) ?? {}) };
  }

  async setConfig(patch: Partial<Config>): Promise<void> {
    const bad = (why: string) => new Error(`INVALID_CONFIG: ${why}`);
    if (patch.twoStage !== undefined && typeof patch.twoStage !== 'boolean') throw bad('twoStage는 켬/끔이어야 합니다');
    if (patch.urgentDays !== undefined && !(Number.isInteger(patch.urgentDays) && patch.urgentDays >= 1 && patch.urgentDays <= 60)) throw bad('긴급 기준은 1~60일');
    if (patch.holdCapDays !== undefined && !(Number.isInteger(patch.holdCapDays) && patch.holdCapDays >= 0 && patch.holdCapDays <= 30)) throw bad('1차 보류 상한은 0~30일');
    if (patch.alertPlan !== undefined && !Object.hasOwn(ALERT_PLANS, patch.alertPlan)) throw bad(`알 수 없는 알림 계획표: ${String(patch.alertPlan)}`);
    const cur = await this.getConfig();
    await this.repo.setSetting('config', { ...cur, ...patch });
    // 계획표를 바꾼 날을 기록한다: 비소급 계획은 이 날 이전에 지난 단계를 만들지 않는다.
    if (patch.alertPlan !== undefined && patch.alertPlan !== cur.alertPlan) {
      await this.repo.setSetting('alertPlanActivatedOn', (await this.getClock()).today);
    }
    await this.sweepReview();
  }

  // ---------- 알림 계획표 ----------
  /** 준비됨 = 상신 가능/상신된 상태이고 필요 정보·열린 확인 요청이 없음 */
  private async isReady(c: Computed, caseId: string, status: Status): Promise<boolean> {
    if (status !== 'routed' && status !== 'submitted') return false;
    if (c.routes.get(caseId)!.needsInfo.length > 0) return false;
    return (await this.repo.listInfoRequests({ status: 'requested', caseId })).length === 0;
  }

  private async runPlan(
    c: Computed, cfg: Config, activated: IsoDate, st: { caseId: string; status: string; routeLevel: string }, k: { effectiveDeadline: IsoDate },
  ): Promise<Raised[]> {
    const raised: Raised[] = [];
    const today = c.clock.today;
    const status = st.status as Status;
    const route = st.routeLevel as RouteLevel;
    const plan = ALERT_PLANS[cfg.alertPlan];
    const review = cfg.twoStage && route === 'CEO_BOARD' ? await this.reviewOrDefault(st.caseId) : null;
    const ready = await this.isReady(c, st.caseId, status);
    for (const row of plan.rows) {
      if (row.onlyForRoutes && !row.onlyForRoutes.includes(route)) continue;
      if (row.condition === 'undecided' && !needsEscalation(status)) continue;
      const trigger = addDays(k.effectiveDeadline, -row.daysBefore);
      if (today < trigger) continue;
      if (!plan.retroactive && trigger < activated) continue; // 이미 지난 단계는 소급하지 않는다
      const kind = row.kind ?? 'alert';
      const stage = `D-${row.daysBefore}`;
      const payload = {
        recipients: recipientsFor(row, route, { ready, parallel: review?.parallel === true }),
        simulated: true, planId: plan.id, planVersion: plan.version, ready,
        ...(kind === 'escalation' ? { options: [...ESCALATION_OPTIONS], message: MESSAGE_TEXT.escalation } : {}),
      };
      if (await this.repo.insertAlertIfAbsent({ caseId: st.caseId, stage, kind, businessDate: today, payload })) {
        raised.push({ caseId: st.caseId, stage, kind });
      }
    }
    if (review) raised.push(...(await this.runReviewGuard(c, cfg, plan.holdOverdueWarning, st.caseId, status, k.effectiveDeadline, review)));
    return raised;
  }

  /** 1차 미결 + 긴급이면 CEO에게 병행 상신, 1차 보류가 자기 기한을 넘기면(확장 계획) 즉시 경고 */
  private async runReviewGuard(
    c: Computed, cfg: Config, warnOnOverdue: boolean, caseId: string, status: Status, eff: IsoDate, review: ReviewRow,
  ): Promise<Raised[]> {
    const raised: Raised[] = [];
    const today = c.clock.today;
    const left = daysBetween(today, eff);
    const open = review.state === 'pending' || review.state === 'held';
    if (status === 'submitted' && open && !review.parallel && left >= 0 && left <= cfg.urgentDays) {
      // 동시에 두 번 돌아도 먼저 선점한 한 번만 병행 상신한다.
      if (!(await this.repo.claimReview(caseId, { states: ['pending', 'held'], parallel: false }, { parallel: true, parallelDate: today }))) return raised;
      await this.log(c, caseId, 'system', 'parallel_escalate', { simulated: false, detail: { urgentDays: cfg.urgentDays, daysLeft: left, primary: review.state } });
      await this.repo.insertAlertIfAbsent({
        caseId, stage: 'parallel', kind: 'parallel', businessDate: today,
        payload: { simulated: true, recipients: [{ role: 'ceo_board', messageKey: 'parallel_request' }, { role: 'masil_ceo', messageKey: 'primary_pending' }] },
      });
      raised.push({ caseId, stage: 'parallel', kind: 'parallel' });
    }
    if (warnOnOverdue && status === 'submitted' && review.state === 'held' && review.holdDue && today > review.holdDue) {
      const inserted = await this.repo.insertAlertIfAbsent({
        caseId, stage: 'primary_hold_overdue', kind: 'warning', businessDate: today,
        payload: { simulated: true, recipients: [{ role: 'masil_ceo', messageKey: 'primary_hold_overdue' }, { role: 'ceo_board', messageKey: 'primary_hold_overdue' }] },
      });
      if (inserted) raised.push({ caseId, stage: 'primary_hold_overdue', kind: 'warning' });
    }
    return raised;
  }

  /** 활성 계획표의 각 단계가 이 건에서 지났는지·예정인지·발송됐는지 */
  async alertPlanStatus(caseId: string): Promise<PlanStageStatus[]> {
    const c = await this.compute();
    const cfg = await this.getConfig();
    const activated = (await this.repo.getSetting<IsoDate>('alertPlanActivatedOn')) ?? c.clock.asOf;
    const st = await this.requireState(caseId);
    const k = c.cases.find((x) => x.id === caseId)!;
    const sent = new Set((await this.repo.listAlerts(caseId)).map((a) => `${a.stage}|${a.kind}`));
    const plan = ALERT_PLANS[cfg.alertPlan];
    return plan.rows.map((row) => {
      const kind = row.kind ?? 'alert';
      const stage = `D-${row.daysBefore}`;
      const triggerDate = addDays(k.effectiveDeadline, -row.daysBefore);
      let state: PlanStageStatus['state'];
      if (sent.has(`${stage}|${kind}`)) state = 'sent';
      else if (row.onlyForRoutes && !row.onlyForRoutes.includes(st.routeLevel)) state = 'not_applicable';
      else if (!plan.retroactive && triggerDate < activated) state = 'passed';
      else if (c.clock.today < triggerDate) state = 'scheduled';
      else state = 'due';
      return { stage, daysBefore: row.daysBefore, kind, triggerDate, state };
    });
  }

  // ---------- 1차/2차 결재 (설정으로 켠 CEO/이사회 경로만) ----------
  private async reviewOrDefault(caseId: string): Promise<ReviewRow> {
    const rv = (await this.repo.getReview(caseId)) ??
      { caseId, state: 'pending' as const, parallel: false, parallelDate: null, holdDue: null, holdRequestId: null };
    // 1차 보류의 확인 요청이 다른 경로(같은 주제 회신 등)로 닫혔으면 보류를 풀어 상태와 어긋나지 않게 한다.
    if (rv.state === 'held' && rv.holdRequestId !== null) {
      const req = await this.repo.getInfoRequest(rv.holdRequestId);
      if (!req || req.status !== 'requested') {
        await this.repo.claimReview(caseId, { states: ['held'] }, { state: 'pending', holdDue: null, holdRequestId: null });
        return { ...rv, state: 'pending', holdDue: null, holdRequestId: null };
      }
    }
    return rv;
  }

  private async reviewView(c: Computed, caseId: string, route: RouteLevel): Promise<ReviewView | null> {
    const cfg = await this.getConfig();
    if (!cfg.twoStage || route !== 'CEO_BOARD') return null;
    const rv = await this.reviewOrDefault(caseId);
    const eff = c.cases.find((x) => x.id === caseId)!.effectiveDeadline;
    const holdCapDate = addDays(eff, -cfg.holdCapDays);
    return {
      state: rv.state, parallel: rv.parallel, parallelDate: rv.parallelDate, holdDue: rv.holdDue, holdCapDate,
      canHold: rv.state === 'pending' && c.clock.today <= holdCapDate, urgentDays: cfg.urgentDays,
    };
  }

  private async primaryContext(id: string, actor: Actor) {
    const cfg = await this.getConfig();
    if (actor !== 'masil_ceo') throw new Error(`ROLE_NOT_ALLOWED: 1차 검토는 Masil 대표만 합니다(${actor})`);
    const st = await this.requireState(id);
    if (!cfg.twoStage || st.routeLevel !== 'CEO_BOARD' || st.status !== 'submitted') {
      throw new Error(`PRIMARY_NOT_AVAILABLE: ${id}: 1차 검토 대상이 아닙니다(설정 켬 + CEO/이사회 경로 + 상신됨 상태만)`);
    }
    const rv = await this.reviewOrDefault(id);
    if (rv.state !== 'pending' && rv.state !== 'held') throw new Error(`PRIMARY_NOT_AVAILABLE: 1차 검토가 이미 ${rv.state} 상태입니다`);
    const c = await this.compute();
    return { cfg, st, rv, c, eff: c.cases.find((x) => x.id === id)!.effectiveDeadline };
  }

  /** 1차 상신: 대표 검토를 마치고 CEO/이사회 최종 결정(2차)으로 올린다. */
  async primaryEscalate(id: string, actor: Actor): Promise<void> {
    const { rv, c } = await this.primaryContext(id, actor);
    const ok = await this.repo.claimReview(id, { states: ['pending', 'held'] }, { state: 'escalated', holdDue: null, holdRequestId: null });
    if (!ok) throw new Error(`PRIMARY_NOT_AVAILABLE: ${id}의 1차 검토가 방금 다른 요청으로 처리되었습니다`);
    if (rv.holdRequestId !== null) await this.repo.updateInfoRequest(rv.holdRequestId, { status: 'closed' });
    await this.log(c, id, actor, 'primary_escalate');
  }

  /** 1차 보류: 업무 시계는 멈추지 않는다. 담당·기한 필수, 기한은 실효 결정 기한 − 상한 일수 이내. */
  async primaryHold(id: string, actor: Actor, hold: HoldInput): Promise<void> {
    const { cfg, rv, c, eff } = await this.primaryContext(id, actor);
    const bad = (why: string) => new Error(`HOLD_REQUIRES_OWNER_AND_DUE: ${why}`);
    if (!hold || !hold.needed || hold.needed.trim() === '') throw bad('필요한 정보 없음');
    if (!isRole(hold.ownerRole)) throw bad('담당 역할 없음');
    if (!isIsoDate(hold.dueDate)) throw bad('기한 없음');
    if (rv.state === 'held') throw new Error('PRIMARY_ALREADY_HELD: 1차 보류가 이미 있습니다. 먼저 회신을 받아 해제하세요');
    const cap = addDays(eff, -cfg.holdCapDays);
    if (cap < c.clock.today) throw new Error(`PRIMARY_HOLD_NOT_ALLOWED: 보류 상한일 ${cap}이 이미 지났습니다. 바로 2차(CEO/이사회)로 올리세요`);
    if (hold.dueDate < c.clock.today) throw bad(`기한 ${hold.dueDate}이 오늘 ${c.clock.today}보다 이전`);
    if (hold.dueDate > cap) throw new Error(`PRIMARY_HOLD_LIMIT: 1차 보류 기한은 ${cap}(실효 결정 기한 ${eff} − ${cfg.holdCapDays}일)을 넘을 수 없습니다`);
    // 먼저 보류를 선점한 요청 하나만 확인 요청을 만든다.
    if (!(await this.repo.claimReview(id, { states: ['pending'] }, { state: 'held', holdDue: hold.dueDate, holdRequestId: null }))) {
      throw new Error('PRIMARY_ALREADY_HELD: 1차 보류가 방금 다른 요청으로 처리되었습니다');
    }
    const reqId = await this.repo.addInfoRequest({
      caseId: id, needed: hold.needed, ownerRole: hold.ownerRole, dueDate: hold.dueDate, createdDate: c.clock.today, simulated: true,
    });
    if (!(await this.repo.claimReview(id, { states: ['held'] }, { holdRequestId: reqId }))) {
      // 그 사이 CEO가 먼저 결정해 1차가 닫혔다: 고아 요청을 남기지 않는다.
      await this.repo.updateInfoRequest(reqId, { status: 'closed' });
      throw new Error('PRIMARY_NOT_AVAILABLE: 1차 보류를 만드는 동안 CEO/이사회가 먼저 결정했습니다');
    }
    await this.log(c, id, actor, 'primary_hold', { detail: hold });
  }

  /** 1차 반려: 거절(재상신 가능)과 같다. */
  async primaryReturn(id: string, actor: Actor, reason: string): Promise<void> {
    requireReason(reason);
    const { st, rv, c } = await this.primaryContext(id, actor);
    const next = transition(st, 'primary_return', actor);
    if (!(await this.repo.transitionState(id, st.status, { status: next, routeLevel: st.routeLevel, updatedBusinessDate: c.clock.today }))) {
      throw new Error(`INVALID_TRANSITION: ${id}: 방금 다른 요청으로 처리되었습니다`);
    }
    if (rv.holdRequestId !== null) await this.repo.updateInfoRequest(rv.holdRequestId, { status: 'closed' });
    await this.repo.claimReview(id, { states: ['pending', 'held', 'escalated'] }, { state: 'returned', holdDue: null, holdRequestId: null });
    await this.closeOpenRequests(id);
    await this.log(c, id, actor, 'primary_return', { detail: { reason: reason.trim() } });
  }

  /** 긴급 구간 안에서 상신·재상신하거나 설정을 켜면 시계를 다시 넘기지 않아도 병행 상신을 보낸다. */
  private async sweepReview(): Promise<void> {
    const cfg = await this.getConfig();
    if (!cfg.twoStage) return;
    const c = await this.compute();
    for (const st of await this.repo.listStates()) {
      if (st.routeLevel !== 'CEO_BOARD' || st.status !== 'submitted') continue;
      const k = c.cases.find((x) => x.id === st.caseId)!;
      await this.runReviewGuard(c, cfg, false, st.caseId, 'submitted', k.effectiveDeadline, await this.reviewOrDefault(st.caseId));
    }
  }

  private async releasePrimaryHold(c: Computed, caseId: string, requestId: number): Promise<void> {
    const rv = await this.repo.getReview(caseId);
    if (rv && rv.state === 'held' && rv.holdRequestId === requestId) {
      await this.repo.saveReview({ ...rv, state: 'pending', holdDue: null, holdRequestId: null });
      await this.log(c, caseId, 'system', 'primary_hold_released', { simulated: false });
    }
  }

  async setScenario(id: ScenarioId): Promise<void> {
    if (!Object.hasOwn(SCENARIOS, id)) throw new Error(`UNKNOWN_SCENARIO: ${id}`);
    const prev = (await this.repo.getSetting<ScenarioId>('scenario')) ?? 'baseline';
    // 같은 시나리오여도 재판정은 멱등이라 다시 돌린다(도중 실패 후 재시도로 누락을 메운다).
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
