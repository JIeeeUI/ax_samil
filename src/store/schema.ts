/** 멱등 DDL. 날짜는 모두 text('YYYY-MM-DD')로 두어 타임존 변환을 막는다. */
export const SCHEMA_SQL = `
create table if not exists clock (
  id integer primary key check (id = 1),
  as_of text not null,
  today text not null
);
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
create table if not exists case_state (
  case_id text primary key,
  status text not null,
  route_level text not null,
  updated_business_date text not null
);
create table if not exists events (
  id integer generated always as identity primary key,
  case_id text not null,
  business_date text not null,
  real_time text not null,
  actor_role text not null,
  action text not null,
  detail jsonb,
  snapshot jsonb,
  assumption_version text not null,
  simulated boolean not null default false
);
create table if not exists info_requests (
  id integer generated always as identity primary key,
  case_id text not null,
  needed text not null,
  owner_role text not null,
  due_date text not null,
  status text not null default 'requested',
  draft_text text,
  reply_text text,
  reply_values jsonb,
  simulated boolean not null default false,
  created_date text not null,
  replied_date text
);
create table if not exists alerts (
  case_id text not null,
  stage text not null,
  kind text not null,
  business_date text not null,
  payload jsonb,
  primary key (case_id, stage, kind)
);
`;
