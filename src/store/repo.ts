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
    await this.db.exec('truncate table clock, settings, case_state, events, info_requests, alerts restart identity');
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
