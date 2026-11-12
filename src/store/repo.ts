import type { IsoDate } from '../engine/types.js';
import type { Db } from './db.js';
import { SCHEMA_SQL } from './schema.js';

export interface Clock { asOf: IsoDate; today: IsoDate }
export interface StateRow { caseId: string; status: string; routeLevel: string; updatedBusinessDate: IsoDate }
export interface EventInput {
  caseId: string; businessDate: IsoDate; actorRole: string; action: string; assumptionVersion: string;
  detail?: unknown; snapshot?: unknown; simulated?: boolean;
}
export interface EventRow {
  id: number; case_id: string; business_date: IsoDate; real_time: string; actor_role: string; action: string;
  detail: unknown; snapshot: unknown; assumption_version: string; simulated: boolean;
}
export interface InfoRequestInput {
  caseId: string; needed: string; ownerRole: string; dueDate: IsoDate; createdDate: IsoDate;
  draftText?: string; simulated?: boolean;
}
export interface InfoRequestRow {
  id: number; caseId: string; needed: string; ownerRole: string; dueDate: IsoDate; status: string;
  draftText: string | null; replyText: string | null; replyValues: Record<string, unknown> | null;
  simulated: boolean; createdDate: IsoDate; repliedDate: IsoDate | null;
}
export interface ReviewRow {
  caseId: string; state: 'pending' | 'held' | 'escalated' | 'returned' | 'closed_parallel'; parallel: boolean;
  parallelDate: IsoDate | null; holdDue: IsoDate | null; holdRequestId: number | null;
}
export interface RevisionRow {
  id: number; caseId: string; round: number; reasons: string[]; otherText: string | null; opinion: string;
  returnDate: IsoDate; dueDate: IsoDate; status: 'open' | 'adjusted' | 'kept' | 'consult' | 'unanswered';
  replyText: string | null; repliedDate: IsoDate | null;
}
export interface NoticeRow {
  caseId: string; kind: 'terminate' | 'change' | 'renew_confirm'; required: boolean; dueDate: IsoDate; createdDate: IsoDate;
  status: 'open' | 'sent' | 'done' | 'void'; sentDate: IsoDate | null; sentBy: string | null; receiptProof: boolean | null;
  recordedDate: IsoDate | null; recordedBy: string | null; simulated: boolean;
}
export interface AlertInput { caseId: string; stage: string; kind: string; businessDate: IsoDate; payload?: unknown }
export interface AlertRow { case_id: string; stage: string; kind: string; business_date: IsoDate; payload: unknown }

type RawState = { case_id: string; status: string; route_level: string; updated_business_date: string };

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const toState = (r: RawState): StateRow => ({
  caseId: r.case_id, status: r.status, routeLevel: r.route_level, updatedBusinessDate: r.updated_business_date,
});
const toInfo = (r: Record<string, unknown>): InfoRequestRow => ({
  id: r.id as number, caseId: r.case_id as string, needed: r.needed as string, ownerRole: r.owner_role as string,
  dueDate: r.due_date as string, status: r.status as string, draftText: (r.draft_text as string) ?? null,
  replyText: (r.reply_text as string) ?? null, replyValues: (r.reply_values as Record<string, unknown>) ?? null,
  simulated: r.simulated as boolean, createdDate: r.created_date as string, repliedDate: (r.replied_date as string) ?? null,
});

export class Repo {
  constructor(private db: Db) {}

  async migrate(): Promise<void> { await this.db.exec(SCHEMA_SQL); }

  async resetAll(): Promise<void> {
    await this.db.exec('truncate table clock, settings, case_state, events, info_requests, alerts, review1, revisions, notices restart identity');
  }

  async getClock(): Promise<Clock | null> {
    const r = await this.db.query<{ as_of: string; today: string }>('select as_of, today from clock where id = 1');
    return r[0] ? { asOf: r[0].as_of, today: r[0].today } : null;
  }
  async setClock(c: Clock): Promise<void> {
    await this.db.query(
      'insert into clock (id, as_of, today) values (1, $1, $2) on conflict (id) do update set as_of = $1, today = $2',
      [c.asOf, c.today]);
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const r = await this.db.query<{ value: T }>('select value from settings where key = $1', [key]);
    return r[0] ? r[0].value : null;
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.query(
      'insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb',
      [key, json(value)]);
  }

  async upsertState(s: StateRow): Promise<void> {
    await this.db.query(
      `insert into case_state (case_id, status, route_level, updated_business_date) values ($1, $2, $3, $4)
       on conflict (case_id) do update set status = $2, route_level = $3, updated_business_date = $4`,
      [s.caseId, s.status, s.routeLevel, s.updatedBusinessDate]);
  }
  /** 기대한 상태일 때만 갱신한다(동시 요청의 이중 처리 방지). 갱신했으면 true. */
  async transitionState(caseId: string, expected: string, s: { status: string; routeLevel: string; updatedBusinessDate: IsoDate }): Promise<boolean> {
    const r = await this.db.query(
      `update case_state set status = $3, route_level = $4, updated_business_date = $5
       where case_id = $1 and status = $2 returning case_id`,
      [caseId, expected, s.status, s.routeLevel, s.updatedBusinessDate]);
    return r.length > 0;
  }
  async getState(caseId: string): Promise<StateRow | null> {
    const r = await this.db.query<RawState>('select * from case_state where case_id = $1', [caseId]);
    return r[0] ? toState(r[0]) : null;
  }
  async listStates(): Promise<StateRow[]> {
    const r = await this.db.query<RawState>('select * from case_state order by case_id');
    return r.map(toState);
  }

  async addEvent(e: EventInput): Promise<number> {
    const r = await this.db.query<{ id: number }>(
      `insert into events (case_id, business_date, real_time, actor_role, action, detail, snapshot, assumption_version, simulated)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9) returning id`,
      [e.caseId, e.businessDate, new Date().toISOString(), e.actorRole, e.action, json(e.detail), json(e.snapshot),
        e.assumptionVersion, e.simulated ?? false]);
    return r[0].id;
  }
  async listEvents(caseId?: string): Promise<EventRow[]> {
    return caseId === undefined
      ? this.db.query<EventRow>('select * from events order by id')
      : this.db.query<EventRow>('select * from events where case_id = $1 order by id', [caseId]);
  }

  async addInfoRequest(i: InfoRequestInput): Promise<number> {
    const r = await this.db.query<{ id: number }>(
      `insert into info_requests (case_id, needed, owner_role, due_date, draft_text, simulated, created_date)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [i.caseId, i.needed, i.ownerRole, i.dueDate, i.draftText ?? null, i.simulated ?? false, i.createdDate]);
    return r[0].id;
  }
  async getInfoRequest(id: number): Promise<InfoRequestRow | null> {
    const r = await this.db.query('select * from info_requests where id = $1', [id]);
    return r[0] ? toInfo(r[0]) : null;
  }
  async listInfoRequests(filter: { status?: string; caseId?: string } = {}): Promise<InfoRequestRow[]> {
    const r = await this.db.query(
      'select * from info_requests where ($1::text is null or status = $1) and ($2::text is null or case_id = $2) order by id',
      [filter.status ?? null, filter.caseId ?? null]);
    return r.map(toInfo);
  }
  async updateInfoRequest(id: number, p: {
    status?: string; replyText?: string; replyValues?: unknown; draftText?: string; repliedDate?: IsoDate; simulated?: boolean;
  }): Promise<void> {
    await this.db.query(
      `update info_requests set status = coalesce($2, status), reply_text = coalesce($3, reply_text),
         reply_values = coalesce($4::jsonb, reply_values), draft_text = coalesce($5, draft_text),
         replied_date = coalesce($6, replied_date), simulated = coalesce($7, simulated) where id = $1`,
      [id, p.status ?? null, p.replyText ?? null, json(p.replyValues), p.draftText ?? null, p.repliedDate ?? null, p.simulated ?? null]);
  }

  async getReview(caseId: string): Promise<ReviewRow | null> {
    const r = await this.db.query<Record<string, unknown>>('select * from review1 where case_id = $1', [caseId]);
    if (!r[0]) return null;
    const x = r[0];
    return {
      caseId, state: x.state as ReviewRow['state'], parallel: x.parallel as boolean, parallelDate: (x.parallel_date as string) ?? null,
      holdDue: (x.hold_due as string) ?? null, holdRequestId: (x.hold_request_id as number) ?? null,
    };
  }
  async listReviews(): Promise<ReviewRow[]> {
    const r = await this.db.query<{ case_id: string }>('select case_id from review1');
    const out: ReviewRow[] = [];
    for (const x of r) { const v = await this.getReview(x.case_id); if (v) out.push(v); }
    return out;
  }
  async deleteReview(caseId: string): Promise<void> {
    await this.db.query('delete from review1 where case_id = $1', [caseId]);
  }
  /**
   * 기대한 상태(와 병행 상신 여부)일 때만 검토 행을 바꾼다. 성공하면 true.
   * 행이 없으면 pending 기본 행을 먼저 만든다. 동시 요청 중 하나만 성공한다.
   */
  async claimReview(
    caseId: string,
    from: { states: ReviewRow['state'][]; parallel?: boolean },
    patch: Partial<Omit<ReviewRow, 'caseId'>>,
  ): Promise<boolean> {
    await this.db.query("insert into review1 (case_id, state, parallel) values ($1, 'pending', false) on conflict do nothing", [caseId]);
    const cols = { state: 'state', parallel: 'parallel', parallelDate: 'parallel_date', holdDue: 'hold_due', holdRequestId: 'hold_request_id' } as const;
    const params: unknown[] = [caseId];
    const sets: string[] = [];
    for (const [k, col] of Object.entries(cols)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) return false;
    const marks = from.states.map((s) => { params.push(s); return `$${params.length}`; });
    let where = `case_id = $1 and state in (${marks.join(', ')})`;
    if (from.parallel !== undefined) { params.push(from.parallel); where += ` and parallel = $${params.length}`; }
    const r = await this.db.query(`update review1 set ${sets.join(', ')} where ${where} returning case_id`, params);
    return r.length > 0;
  }
  async saveReview(r: ReviewRow): Promise<void> {
    await this.db.query(
      `insert into review1 (case_id, state, parallel, parallel_date, hold_due, hold_request_id) values ($1, $2, $3, $4, $5, $6)
       on conflict (case_id) do update set state = $2, parallel = $3, parallel_date = $4, hold_due = $5, hold_request_id = $6`,
      [r.caseId, r.state, r.parallel, r.parallelDate, r.holdDue, r.holdRequestId]);
  }

  async addRevision(r: { caseId: string; round: number; reasons: string[]; otherText?: string; opinion: string; returnDate: IsoDate; dueDate: IsoDate }): Promise<number> {
    const x = await this.db.query<{ id: number }>(
      `insert into revisions (case_id, round, reasons, other_text, opinion, return_date, due_date) values ($1, $2, $3::jsonb, $4, $5, $6, $7) returning id`,
      [r.caseId, r.round, JSON.stringify(r.reasons), r.otherText ?? null, r.opinion, r.returnDate, r.dueDate]);
    return x[0].id;
  }
  async listRevisions(caseId?: string): Promise<RevisionRow[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select * from revisions where ($1::text is null or case_id = $1) order by id', [caseId ?? null]);
    return rows.map((x) => ({
      id: x.id as number, caseId: x.case_id as string, round: x.round as number, reasons: x.reasons as string[],
      otherText: (x.other_text as string) ?? null, opinion: x.opinion as string, returnDate: x.return_date as string,
      dueDate: x.due_date as string, status: x.status as RevisionRow['status'], replyText: (x.reply_text as string) ?? null,
      repliedDate: (x.replied_date as string) ?? null,
    }));
  }
  /** 열린 상태일 때만 닫는다(동시 처리 방지). */
  async closeRevision(id: number, status: Exclude<RevisionRow['status'], 'open'>, replyText: string | null, repliedDate: IsoDate): Promise<boolean> {
    const r = await this.db.query(
      "update revisions set status = $2, reply_text = $3, replied_date = $4 where id = $1 and status = 'open' returning id",
      [id, status, replyText, repliedDate]);
    return r.length > 0;
  }

  async getNotice(caseId: string): Promise<NoticeRow | null> {
    const r = await this.db.query<Record<string, unknown>>('select * from notices where case_id = $1', [caseId]);
    const x = r[0];
    if (!x) return null;
    return {
      caseId, kind: x.kind as NoticeRow['kind'], required: x.required as boolean, dueDate: x.due_date as string,
      createdDate: x.created_date as string, status: x.status as NoticeRow['status'], sentDate: (x.sent_date as string) ?? null,
      sentBy: (x.sent_by as string) ?? null, receiptProof: (x.receipt_proof as boolean) ?? null,
      recordedDate: (x.recorded_date as string) ?? null, recordedBy: (x.recorded_by as string) ?? null, simulated: x.simulated as boolean,
    };
  }
  /** 결정마다 통보 작업을 새로 만든다(이전 것은 덮어씀). */
  async putNotice(n: { caseId: string; kind: NoticeRow['kind']; required: boolean; dueDate: IsoDate; createdDate: IsoDate }): Promise<void> {
    await this.db.query(
      `insert into notices (case_id, kind, required, due_date, created_date) values ($1, $2, $3, $4, $5)
       on conflict (case_id) do update set kind = $2, required = $3, due_date = $4, created_date = $5, status = 'open',
         sent_date = null, sent_by = null, receipt_proof = null, recorded_date = null, recorded_by = null`,
      [n.caseId, n.kind, n.required, n.dueDate, n.createdDate]);
  }
  /** 기대한 상태일 때만 바꾼다. 성공하면 true. */
  async updateNotice(caseId: string, from: NoticeRow['status'], patch: { status: NoticeRow['status']; sentDate?: IsoDate; sentBy?: string; receiptProof?: boolean; recordedDate?: IsoDate; recordedBy?: string }): Promise<boolean> {
    const r = await this.db.query(
      `update notices set status = $3, sent_date = coalesce($4, sent_date), sent_by = coalesce($5, sent_by),
         receipt_proof = coalesce($6, receipt_proof), recorded_date = coalesce($7, recorded_date), recorded_by = coalesce($8, recorded_by)
       where case_id = $1 and status = $2 returning case_id`,
      [caseId, from, patch.status, patch.sentDate ?? null, patch.sentBy ?? null, patch.receiptProof ?? null, patch.recordedDate ?? null, patch.recordedBy ?? null]);
    return r.length > 0;
  }

  async insertAlertIfAbsent(a: AlertInput): Promise<boolean> {
    const r = await this.db.query(
      `insert into alerts (case_id, stage, kind, business_date, payload) values ($1, $2, $3, $4, $5::jsonb)
       on conflict do nothing returning case_id`,
      [a.caseId, a.stage, a.kind, a.businessDate, json(a.payload)]);
    return r.length > 0;
  }
  async listAlerts(caseId?: string): Promise<AlertRow[]> {
    return caseId === undefined
      ? this.db.query<AlertRow>('select * from alerts order by business_date, case_id, stage')
      : this.db.query<AlertRow>('select * from alerts where case_id = $1 order by business_date, stage', [caseId]);
  }
}
