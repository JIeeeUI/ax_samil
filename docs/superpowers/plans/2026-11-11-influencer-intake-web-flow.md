# 인플루언서 제안 접수·판정 — 웹 결재 흐름 Implementation Plan (계획 2: 살 + 모양)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 1의 계산 엔진 위에 결재 흐름(상태·이력·확인 요청·기한 가드·AI 보조)과 4개 화면을 얹고, 시연 3건을 배포 주소에서 재현할 수 있게 한다. 먼저 엔진의 보류 결함 4건을 고친다.

**Architecture:** 엔진(`src/engine/*`)은 순수 함수로 유지한다. 그 위에 순수 도메인 규칙(`src/workflow/*`), 저장소(`src/store/*`, PostgreSQL 호환), 서비스(`src/app/service.ts`), AI 어댑터(`src/ai/*`)를 쌓고, Next.js App Router 화면(`app/*`)은 서비스만 호출한다. 상태는 모두 DB에 두고, 로컬·테스트는 같은 SQL을 내장 Postgres(PGlite)에서 돌린다.

**Tech Stack:** Node 24, TypeScript 5 strict, Vitest, Next.js 15(App Router)·React 19, `pg`(운영), `@electric-sql/pglite`(로컬·테스트). 설치 후 resolve된 정확한 버전을 `package.json`에 고정한다.

**Spec:** `docs/superpowers/specs/2026-11-11-influencer-intake-design.md` (5.4~5.6, 6~13장). 선행: `docs/superpowers/plans/2026-11-11-influencer-intake-engine.md`(계획 1, 완료). 이 계획의 엔진 부분은 명세 13장 보류 항목 ①~④를 닫는다.

## Global Constraints

- 원본 폴더 `01_참가자_배포용/04_원본데이터`는 읽기 전용(쓰기 금지, 해시 불변 테스트 유지). 가공·생성 파일은 그 밖에 둔다.
- `.claude`, `.codex`, `.agents` 폴더와 `.gitignore`는 수정 금지. 무시 규칙은 `.git/info/exclude`(이미 `node_modules/`, `.next/` 있음). 모든 커밋 직전 `git check-ignore .claude/settings.local.json .codex/hooks.json .agents/hooks.json`가 세 줄을 모두 출력해야 한다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `pre.md`, `docs/qa-prep.md`는 커밋하지 않는다.
- **push·`main` 병합은 사용자가 그 시점에 명시적으로 허락한 뒤에만 한다.** `origin`은 axhub 저장소이고 `main` push는 자동 재배포다. 작업은 `feat/intake-engine` 끝에서 새로 딴 브랜치 `feat/approval-flow`에서 한다.
- 날짜는 `YYYY-MM-DD` 문자열(`IsoDate`), DB에도 `text`로 저장한다(타임존 변환 방지). 금액은 원 정수.
- 계산·판정은 코드가 확정한다. AI는 승인·거절을 결정하지 않고, AI 문장 속 숫자·날짜는 엔진 값과 대조해 불일치하면 반영하지 않는다(명세 10장).
- 모의 입력·회신은 화면과 이력에 "모의"로 표시한다. 표본 계열 금액에 풀스케일 금액을 곱하거나 합산한 값은 만들지 않는다.
- 로그인은 만들지 않는다. 역할은 `marketing | finance | contract | masil_ceo | ceo_board` 다섯 개를 화면에서 전환한다.
- 운영(`NODE_ENV=production`)에서 `DATABASE_URL`이 없으면 시작 시 오류로 멈춘다(메모리 DB로 조용히 동작 금지). `ANTHROPIC_API_KEY`는 사용자가 직접 등록하며 에이전트는 입력하지 않는다.

## Review Focus

1. 업무 시계를 과거로 되돌리거나 같은 날로 다시 진행 — 되돌리기는 거부, 같은 날 재진행은 알림·이력이 중복되지 않아야 한다. (Task 6)
2. 이미 종결(승인·거절 후 종결·기한 경과)된 건에 결정 재입력, 같은 버튼 중복 클릭 — 오류를 내고 이력은 1건만 남아야 한다. (Task 5)
3. 확인 요청 회신 값이 형식 오류(날짜가 아님, 음수 금액) — 반영을 거부하고 요청은 "요청" 상태로 남아야 한다. (Task 7)
4. AI가 엔진에 없는 숫자를 쓰거나 호출이 실패·지연 — 그 문장은 쓰지 않고 템플릿으로 대체하며 "AI 미사용" 또는 "숫자 불일치"를 표시해야 한다. (Task 8)
5. 가정 시나리오를 바꾸면(예: LC-0001 45일) 이미 상신된 건의 경로가 달라진다 — 종결되지 않은 건만 재판정하고 이력에 사유를 남겨야 하며 종결 건은 그대로여야 한다. (Task 7)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/engine/cash.ts`, `routing.ts`, `intake.ts`, `calendar.ts`, `dataRoom.ts`, `performance.ts` | (수정) Task 1·2 보정 |
| `src/engine/contract.ts` | 전속계약 위약금 계산 |
| `src/workflow/roles.ts` | 역할 타입·표시명, 경로→결재 역할 |
| `src/workflow/status.ts` | 상태·행위 타입, 전이 규칙, 보류 가드 |
| `src/workflow/guard.ts` | 기한 알림 단계, 에스컬레이션 선택지, 연결 그룹 경고 |
| `src/store/db.ts` | `Db` 인터페이스, `openDb(env)` (pg / PGlite) |
| `src/store/schema.ts` | `SCHEMA_SQL`(멱등 DDL 문자열) |
| `src/store/repo.ts` | 테이블별 읽기·쓰기 |
| `src/app/service.ts` | 엔진+워크플로+저장소를 묶는 서비스(화면·스크립트의 유일한 진입점) |
| `src/app/instance.ts` | 서버 프로세스 단일 서비스 인스턴스 |
| `src/ai/` (`provider.ts`, `verify.ts`, `assist.ts`) | AI 어댑터, 숫자 대조, 보조 3종 |
| `app/` | Next.js 화면·서버 액션·`/api/health` |
| `scripts/demo.ts` | 시연 3건 재현·초기화 |
| `docs/submission/a04-draft.md`, `docs/submission/reproduce.md` | A04 초안, 재현 절차 |

---

### Task 1: 엔진 보정 A — 하회 구간 분리, 현금 기초 잔액 (보류 ①④)

**Files:**
- Modify: `src/engine/cash.ts`, `src/engine/routing.ts`, `src/engine/intake.ts`, `src/engine/calendar.ts`
- Modify(기계적 갱신): `tests/engine/cash.test.ts`, `tests/engine/routing.test.ts`, `tests/engine/review-fixes.test.ts`
- Test: `tests/engine/cash-segments.test.ts`

**Interfaces:**
- Produces:
  - `interface BreachWindow { start: IsoDate; end: IsoDate; businessDays: number }`
  - `CashResult`에서 `breach`를 `breaches: BreachWindow[]`(없으면 `[]`)로 바꾸고 `openingDate: IsoDate` 추가. 한 구간 = `daily`에서 연속된 하회 영업일(주말은 연속을 끊지 않는다).
  - `isInBreach(date, breaches: BreachWindow[]): boolean`, `outflowInBreach(date, breaches): boolean`(주말이면 다음 영업일로 이월 후 판정), `breachWindowFor(date, breaches): BreachWindow | null`(이월 후 날짜가 속한 구간)
  - `routeCase(c, ctx: { breaches: BreachWindow[]; planTotal: number })`. 판정 근거 문구는 해당 구간 하나만 적는다.
  - `previousBusinessDay(d: IsoDate): IsoDate` (calendar.ts)

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/engine/cash-segments.test.ts`) — 합성 `FullTables`(마지막 실적 2026-06-30 종가 4,000,000,000, 기준일 2026-07-01 수요일)로:
  - `two disjoint breaches stay separate`: AP 1,500,000,000을 07-02, AR +1,000,000,000을 07-06(월), AP 1,000,000,000을 07-09에 두고 `horizonEnd='2026-07-10'` → `breaches`가 `[{2026-07-02~07-03, 2}, {2026-07-09~07-10, 2}]`.
  - `date between segments is not in breach`: `outflowInBreach('2026-07-07', breaches) === false`, `'2026-07-03' === true`. 사이 날짜 기안은 `routeCase`가 `CEO_BOARD`가 아니어야 한다.
  - `weekend gap does not split a segment`: 금요일·월요일이 모두 하회면 한 구간.
  - `baseline unchanged`: 기본 가정 `breaches`가 `[{ start:'2026-07-21', end:'2026-08-21', businessDays:24 }]`, `lc45`는 `[]`.
  - `opening is the close of the business day before asOf`: 기본 가정 `opening === 5148063540`, `openingDate === '2026-06-30'`.
  - `opening coverage guard`: `asOf='2026-07-02'`(실적이 직전 영업일 7/1까지 없음)과 `asOf='2026-06-30'`(실적이 기준일을 포함)은 각각 `/기초 잔액/` 메시지로 throw.
  - `previousBusinessDay('2026-07-06') === '2026-07-03'`, `('2026-07-01') === '2026-06-30'`.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/engine/cash-segments.test.ts` → FAIL
- [ ] **Step 3: 구현** — `simulateCash`의 기초 잔액을 `previousBusinessDay(asOf)` 이후이면서 `asOf` 이전인 마지막 실적 행의 종가로 정하고(없으면 위 메시지로 throw), 하회 구간 분리·시그니처 변경을 위 Interfaces대로 적용. `intake.ts`의 `하회구간` 열은 구간을 `, `로 이어 쓴다(구간이 하나면 현재와 같은 문자열).
- [ ] **Step 4: 기존 테스트 갱신** — `cash.test.ts`/`routing.test.ts`/`review-fixes.test.ts`의 `.breach`·`{ breach }`를 `.breaches`·`{ breaches }`로 바꾼다(`null` → `[]`).
- [ ] **Step 5: 전체 검증** — `npm test` → 기존 53개 + 신규 전부 PASS. `npx tsx scripts/intake.ts`로 CSV를 다시 만들고 `git diff --stat outputs/` 가 **변경 없음**이어야 한다(현재 데이터는 하회 구간이 하나라 결과가 같아야 함).
- [ ] **Step 6: 명세 갱신 + 커밋** — 명세 4장 가정 표의 "현금: 기초 잔액"을 "기준일 직전 영업일 종가(실적이 그 날까지 없거나 기준일을 포함하면 오류)"로, 13장 보류 항목 ①④를 해결로 표시. `git add src tests docs outputs && git commit -m "fix(engine): split disjoint breach windows and anchor opening balance to as-of date"`

---

### Task 2: 엔진 보정 B — 빈 숫자 칸 거부, 출고 물류비 (보류 ②③)

**Files:**
- Modify: `src/engine/dataRoom.ts`, `src/engine/performance.ts`
- Test: `tests/engine/data-guards.test.ts`

**Interfaces:**
- Produces: `parseNumericCell(raw: string | null, where: string): number | null`(`null`→`null`, 공백뿐·빈 문자열·비수치·`Infinity`/`NaN`은 `where`를 담은 메시지로 throw), `coerceRows(rows: Record<string,string|null>[], spec: TableSpec, file: string): unknown[]`(`readTable`이 사용, 오류 메시지에 파일·열·행 번호 `행 N` 포함), `TableSpec` export.
- 결정(명세 4장 가정 표에 추가): **출고 물류비는 주문 1건당 1번**(반품 물류비와 같은 규칙, 수량 무관). 제품원가만 `unitsPerOrder`에 비례한다. 기본값 1개에서는 결과가 변하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/engine/data-guards.test.ts`)
  - `empty numeric cell is rejected`: `coerceRows([{ gmv_krw: '' ... }], { numeric:['gmv_krw'] }, 'mkt_orders_ms.csv')`가 `/mkt_orders_ms\.csv.*gmv_krw.*행 1/`로 throw. 공백만(`'  '`)·`'abc'`도 throw.
  - `NONE stays null and 0 stays 0`: `parseNumericCell(null, 'x') === null`, `parseNumericCell('0', 'x') === 0`.
  - `shipping is per order`: `unitsPerOrder`를 1→3으로 바꾼 `CMP-0001`의 `contributionBeforeSpend` 감소량 = 2 × 해당 캠페인 주문들의 `product_cost_krw` 합(`costMaster`로 직접 계산)과 정확히 같다.
  - `baseline numbers unchanged`: 계획 1 정답 기준 테스트(실질 ROAS 음수 6건)가 그대로 통과.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/engine/data-guards.test.ts` → FAIL
- [ ] **Step 3: 구현** — `readTable`의 숫자 변환을 `parseNumericCell` 호출로 대체하고, `performance.ts`에서 출고 물류비의 `* a.unitsPerOrder`를 제거.
- [ ] **Step 4: 전체 검증** — `npm test` PASS. `outputs/` 재생성 시 `git diff --stat outputs/` 변경 없음.
- [ ] **Step 5: 명세 갱신 + 커밋** — 명세 4장 가정 표에 "출고 물류비 | 주문 1건당 1번(수량 무관)"을 추가하고 13장 ②③을 해결로 표시(13장의 보류 항목 4개가 모두 닫힘). `git commit -m "fix(engine): reject blank numeric cells and charge shipping once per order"`

---

### Task 3: 웹 골격 (Next.js) 와 엔진 연결

**Files:**
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/api/health/route.ts`, `next.config.mjs`
- Modify: `package.json`, `tsconfig.json`, `src/engine/dataRoom.ts`
- Test: `tests/web/health.test.ts`

**Interfaces:**
- Produces: `GET /api/health` → `200 {"ok":true}`. `npm run dev | build | start` 스크립트. `defaultDataDir()`는 `DATA_DIR` 없으면 `process.cwd()` 기준 `01_참가자_배포용/04_원본데이터`(번들되면 `import.meta.url` 경로가 틀어지므로 교체).

- [ ] **Step 1: 의존성 설치** — `npm i next react react-dom pg @electric-sql/pglite` / `npm i -D @types/react @types/react-dom @types/pg`. 설치된 정확한 버전으로 `package.json` 고정. 스크립트 `dev`, `build`, `start` 추가(`start`는 `next start -H 0.0.0.0`; 포트는 `PORT` 환경변수를 따른다).
- [ ] **Step 2: 실패하는 테스트 작성** (`tests/web/health.test.ts`): `GET()`의 응답이 상태 200, JSON `{ ok: true }`.
- [ ] **Step 3: 구현** — 라우트 핸들러, `tsconfig.json`을 `module: ESNext`/`moduleResolution: Bundler`/`jsx: preserve`/`plugins:[{name:'next'}]`로 바꾸고 `include`에 `app`, `next-env.d.ts` 추가(엔진의 `.js` 확장자 import는 그대로 해석돼야 함). `next.config.mjs`는 `serverExternalPackages: ['@electric-sql/pglite']`. `app/page.tsx`(서버 컴포넌트)는 `buildIntake(loadDataRoom(), DEFAULT_ASSUMPTIONS).length`(26)을 출력해 엔진 연결을 증명. `defaultDataDir()` 교체.
- [ ] **Step 4: 검증** — `npm test`(53+ PASS, tsc 포함), `npm run build` 성공, 서버를 띄워 `/api/health`가 `{"ok":true}`, `/`에 `26`이 보이는지 확인(내장 브라우저 또는 curl). 빌드가 `.js` import 해석에 실패하면 `next.config.mjs`의 `webpack.resolve.extensionAlias`로 `.js → [.ts, .tsx, .js]`를 지정한다.
- [ ] **Step 5: 커밋** — `git commit -m "feat(web): add Next.js skeleton wired to the intake engine"`

---

### Task 4: 저장소 계층

**Files:**
- Create: `src/store/db.ts`, `src/store/schema.ts`, `src/store/repo.ts`
- Test: `tests/store/repo.test.ts`

**Interfaces:**
- Produces:
  - `interface Db { query<T>(sql: string, params?: unknown[]): Promise<T[]>; exec(sql: string): Promise<void>; close(): Promise<void> }`
  - `openDb(env: { DATABASE_URL?: string; NODE_ENV?: string }): Promise<Db>` — `DATABASE_URL`이 있으면 `pg`, 없으면 PGlite(메모리). 운영인데 `DATABASE_URL` 없으면 throw.
  - `SCHEMA_SQL`(멱등 `create table if not exists`): `clock(id=1, as_of, today)`, `settings(key pk, value jsonb)`(시나리오 id, 전속계약 조건), `case_state(case_id pk, status, route_level, updated_business_date)`, `events(id, case_id, business_date, real_time, actor_role, action, detail jsonb, snapshot jsonb, assumption_version, simulated bool)`, `info_requests(id, case_id, needed, owner_role, due_date, status, draft_text, reply_text, reply_values jsonb, simulated bool, created_date)`, `alerts(case_id, stage, kind, business_date, payload jsonb, primary key(case_id, stage, kind))`.
  - `class Repo { constructor(db: Db) }` — `migrate()`, `getClock()/setClock()`, `getSetting/setSetting`, `upsertState/getState/listStates`, `addEvent/listEvents(caseId)`, `addInfoRequest/getInfoRequest/listInfoRequests(filter)/updateInfoRequest`, `insertAlertIfAbsent(...) → boolean`(새로 넣었으면 true), `listAlerts(caseId?)`, `resetAll()`.
- 의존성 주입: 모든 테스트는 `openDb({})`(PGlite 메모리)를 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/store/repo.test.ts`)
  - `migrate is idempotent` (두 번 호출해도 오류 없음)
  - `events keep insertion order and jsonb snapshots round-trip`
  - `insertAlertIfAbsent returns true once then false` (같은 case/stage/kind)
  - `dates are returned as YYYY-MM-DD strings` (`getClock().today`가 문자열)
  - `production without DATABASE_URL throws`
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 위 시그니처대로. SQL은 `pg`와 PGlite 모두에서 도는 표준 문법만 쓴다(`$1` 파라미터, `jsonb`, `serial` 대신 `generated always as identity`).
- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/store` PASS, `npm test` PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(store): add Postgres-compatible repository with PGlite for local runs"`

---

### Task 5: 역할과 상태 전이 규칙 (순수)

**Files:**
- Create: `src/workflow/roles.ts`, `src/workflow/status.ts`
- Test: `tests/workflow/status.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'marketing'|'finance'|'contract'|'masil_ceo'|'ceo_board'`, `ROLE_LABEL: Record<Role,string>`, `decisionRole(level: RouteLevel): Role` (`CEO_BOARD→ceo_board`, `MASIL_CEO*→masil_ceo`, `MARKETING→marketing`)
  - `type Status = 'finance_review'|'routed'|'submitted'|'approved'|'rejected'|'on_hold'|'overdue'|'closed'`, `TERMINAL: ReadonlySet<Status>`(`approved, overdue, closed`)
  - `type Action = 'confirm_finance'|'submit'|'approve'|'reject'|'hold'|'reply'|'resubmit'|'close'|'expire'`
  - `interface HoldInput { needed: string; ownerRole: Role; dueDate: IsoDate }`
  - `transition(s: { status: Status; routeLevel: RouteLevel }, action: Action, actor: Role, ctx?: { today: IsoDate; hold?: HoldInput }): Status` — 허용되지 않은 조합은 `Error('INVALID_TRANSITION: ...')`.
- 전이: `finance_review -confirm_finance(finance)→ routed -submit(marketing|finance)→ submitted`; `submitted -approve|reject|hold(decisionRole)→ approved|rejected|on_hold`; `on_hold -reply→ routed`(재판정 후 다시 상신); `rejected -resubmit→ submitted`, `rejected -close→ closed`; 종결되지 않은 모든 상태 `-expire(system)→ overdue`. 종결 상태에서는 모든 행위가 거부된다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/workflow/status.test.ts`)
  - `happy path reaches approved`
  - `only the routed decision role may decide` (`CEO_BOARD` 건을 `masil_ceo`가 승인 → throw)
  - `hold requires owner role and a due date not before today` (`dueDate` 누락·과거 → `/HOLD_REQUIRES/` throw; 담당 역할 누락도 동일)
  - `terminal states reject every action` (`approved`에서 `approve` 재입력, `closed`에서 `resubmit` → throw)
  - `rejected can be resubmitted or closed`
  - `expire works from any non-terminal state, never from terminal`
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 전이 표를 데이터(맵)로 두고 `transition`이 그 표와 역할·보류 가드를 검사. `HoldInput.dueDate`는 `ctx.today` 이상이어야 한다.
- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/workflow/status.test.ts` PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(workflow): add roles and status transition rules with hold guard"`

---

### Task 6: 기한 가드와 연결 그룹 경고 (순수)

**Files:**
- Create: `src/workflow/guard.ts`
- Test: `tests/workflow/guard.test.ts`

**Interfaces:**
- Consumes: `Case`, `alertStage` 규칙(`THRESHOLDS.alertDays`), `Status`, `TERMINAL`.
- Produces:
  - `type Stage = 'D-14'|'D-7'|'D-3'|'overdue'`
  - `stagesDue(today: IsoDate, effectiveDeadline: IsoDate): Stage[]` — 시작일이 `today` 이하인 모든 단계. 시작일: D-14 = 기한−14일, D-7 = 기한−7일, D-3 = 기한−3일, overdue = 기한+1일(달력일). 시계를 되돌릴 때 호출하지 않는다.
  - `ESCALATION_OPTIONS: readonly ['change_terms_notice','termination_notice','submit_then_approve']` (조건 변경 통보 / 해지 통보 / 상신 후 승인)
  - `needsEscalation(status: Status): boolean` — D-3 이후 `finance_review|routed|submitted|on_hold`이면 true
  - `interface LinkWarning { influencerId: string; message: string }`, `linkWarnings(cases: Case[], statuses: Map<string, Status>): LinkWarning[]` — 같은 인플루언서의 기안 중 `rejected`가 있고 전속계약이 `finance_review|routed|submitted|on_hold`이면 "기안만 부결, 계약은 자동 갱신" 경고.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/workflow/guard.test.ts`)
  - `stages for the INF-001 contract (deadline 2026-07-17)`: `stagesDue('2026-07-02', …)` = `['D-14']`, `'07-10'` = `['D-14','D-7']`, `'07-14'` = `['D-14','D-7','D-3']`, `'07-18'` = 네 단계 전부(overdue 포함), `'07-17'`에는 overdue 없음.
  - `PLAN-007 effective deadline is its settlement date`(집행 7/17, 확정기한 8/14 → 실효 7/17): 기한 계산이 `min`을 따른 값을 쓰는지 `buildCases` 결과로 확인.
  - `escalation only for undecided states` (`approved`면 false, `on_hold`면 true)
  - `link warning appears when only the plan is rejected`: 혜인(INF-001) 기안 하나 `rejected`+계약 `submitted` → 경고 1건, 계약이 `approved`면 경고 없음, 다른 인플루언서에는 없음.
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 날짜 계산은 `calendar.ts`의 `addDays`/`daysBetween`을 쓴다.
- [ ] **Step 4: 실행해 통과 확인** — `npm test` PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(workflow): add deadline stages, escalation and link-group warnings"`

---

### Task 7: 서비스 계층 (접수·결정·보류·회신·재판정·시계)

**Files:**
- Create: `src/engine/contract.ts`, `src/app/service.ts`, `src/app/instance.ts`
- Test: `tests/engine/contract.test.ts`, `tests/app/service.test.ts`

**Interfaces:**
- Consumes: 엔진 전부(`loadDataRoom`, `buildCases`, `simulateCash`, `routeCase`, `evaluateIssues`, `buildIntake`), `Repo`, `transition`, `stagesDue`, `needsEscalation`, `linkWarnings`.
- Produces:
  - `terminationPenalty(annualFeeKrw: number, terminationDate: IsoDate, term = { start:'2026-09-01', end:'2027-08-31' }): number` = 연 고정 피 × 50% × 잔여 월수 ÷ 12 (월 단위 [가정], 계약 원문 미확인). 잔여 월수 = (종료 연월) − (해지 연월), 갱신 시작 전이면 12, 종료월 이후면 0.
  - `class IntakeService { constructor(deps: { repo: Repo; room: DataRoom }) }`
    - `reset(): Promise<void>` — 저장소 초기화 후 26건을 `finance_review`로 적재, 이력에 `received`/`calculated`(근거 스냅샷 포함) 기록, 현재 단계까지의 알림 생성, 시계는 2026-07-01.
    - `getClock()`, `advanceClock(to: IsoDate): Promise<{ raised: {caseId:string; stage:Stage; kind:'alert'|'escalation'|'expired'}[] }>` — `to`가 현재 업무일보다 과거면 throw, 같으면 아무것도 만들지 않음. 단계별 알림은 `(case, stage, kind)`당 한 번만 만든다. 종결되지 않은 건이 overdue가 되면 `expire`(행위자 `system`)로 `overdue` 처리하고 이력에 "기한 경과(자동 확정)". D-3 이후 `needsEscalation`이면 선택지 3개를 담은 `escalation` 알림을 만든다.
    - `listToday(): Promise<TodayView>` (실효 기한 오름차순; 각 건에 경로, 남은 일수, 알림 단계, 하회 구간 해당, 이슈 코드, 명목·실질 순위, `boardDate`(CEO_BOARD일 때 2026-07-06); 뷰 전체에 현재 `breaches`, 연결 그룹 경고, 시나리오 id)
    - `getCase(id): Promise<CaseDetail>` (접수표 행, 이력, 열린 확인 요청, 연결 그룹 건들, `notes`; 전속계약에는 "금액 판단 유보: 표본 성과 순위와 고정 피를 곱하지 않음", 위약금 `terminationPenalty(fee, '2026-09-01')`)
    - `confirmFinance(id, actor)`, `submit(id, actor)`, `decide(id, actor, decision: 'approve'|'reject'|{ hold: HoldInput })`, `resubmit(id, actor)`, `close(id, actor)` — 모두 `transition`을 거치고 이력(행위자 역할, 업무일, 실제 시각, 근거 스냅샷)을 남긴다. 보류는 `info_requests`를 함께 만든다.
    - `replyInfoRequest(requestId, input: { text: string; values?: { cashOutflowDate?: IsoDate; annualFixedFeeKrw?: number }; simulated: boolean }): Promise<void>` — 값 형식 검증(날짜 형식·실제 달력일, 금액은 양의 정수) 실패 시 throw하고 요청은 `requested` 유지. 값이 있으면 전속계약 조건을 갱신해 경로를 재판정하고 건을 `routed`로 되돌린다(필요정보가 남아 있으면 다시 확인 요청). 값이 없는 회신(지연)은 이력만 남기고 `on_hold` 유지.
    - `proposeContractChange(input: { annualFixedFeeKrw: number; cashOutflowDate?: IsoDate | null }): Promise<void>` — 모의 입력(`simulated: true`)으로 조건을 바꾸고 재판정. 결과 `needsInfo`가 있으면 확인 요청을 자동 생성(담당 `finance`, 기한 = `min(오늘+3일, 실효 기한)` [가정]).
    - `setScenario(id: ScenarioId)` — 종결되지 않은 건만 재판정하고, 경로가 바뀐 건마다 이력에 사유(`scenario A → B`)를 남긴다.

- [ ] **Step 1: 위약금 테스트** (`tests/engine/contract.test.ts`): `terminationPenalty(2_800_000_000,'2026-09-01') === 1_400_000_000`, `(2_800_000_000,'2027-02-15') === 700_000_000`, `(900_000_000,'2026-09-01') === 450_000_000`, `(1_800_000_000,'2027-08-20') === 0`.
- [ ] **Step 2: 서비스 테스트 작성** (`tests/app/service.test.ts`, PGlite 메모리 + 실제 데이터룸) — 각 항목은 한 `test`:
  - `reset seeds 26 cases in finance_review with received/calculated events and current-stage alerts`
  - `baseline routing: 13 cases CEO_BOARD (12 plans + contract) and 13 MASIL_CEO_GROUP_REPORT` (명세 9장 정상)
  - `full happy path`: 한 건을 `confirmFinance → submit → approve`, 이력 4건 이상, 상태 `approved`
  - `decide twice is rejected and leaves one decision event` (Review Focus 2)
  - `hold without owner/due is rejected; valid hold creates an info request`
  - `advanceClock to 2026-07-14 raises D-3 escalation for the contract with three options`; `advanceClock back or same-day` 처리(Review Focus 1)
  - `advanceClock to 2026-07-18 expires the undecided contract into overdue with a history entry`
  - `reply with invalid date is rejected and request stays requested` (Review Focus 3)
  - `contract change 1.8bn stays CEO_BOARD; 0.9bn becomes MASIL_CEO with cash_outflow_date info request` (명세 9장 변경)
  - `reply cashOutflowDate 2026-08-10 → CEO_BOARD; 2026-09-30 → MASIL_CEO` (유리/불리 회신), 지연 회신은 `on_hold` 유지
  - `setScenario('lc45') re-routes only non-terminal cases and logs the reason; closed cases untouched` (Review Focus 5)
  - `contract detail carries the deferred-judgement note and penalty`
- [ ] **Step 3: 실행해 실패 확인** — `npx vitest run tests/engine/contract.test.ts tests/app` → FAIL
- [ ] **Step 4: 구현** — 위 시그니처대로. 경로·이슈·접수표 계산은 엔진 호출만 하고 서비스에서 재구현하지 않는다. 재판정이 필요할 때마다 `buildCases(room, 저장된 전속계약 조건)`을 다시 만든다. `instance.ts`는 `globalThis`에 서비스를 캐시(개발 HMR 중복 방지)하고 `openDb(process.env)`로 연다.
- [ ] **Step 5: 실행해 통과 확인** — `npm test` PASS
- [ ] **Step 6: 커밋** — `git commit -m "feat(app): add intake service with decisions, holds, replies and deadline guard"`

---

### Task 8: AI 어댑터와 숫자 대조

**Files:**
- Create: `src/ai/provider.ts`, `src/ai/verify.ts`, `src/ai/assist.ts`
- Test: `tests/ai/verify.test.ts`, `tests/ai/assist.test.ts`

**Interfaces:**
- Produces:
  - `interface AiProvider { complete(prompt: string): Promise<string> }`; `createProvider(env: { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string }): AiProvider | null` — 키가 없으면 `null`. 키가 있으면 `fetch('https://api.anthropic.com/v1/messages')`(헤더 `x-api-key`, `anthropic-version: 2023-06-01`, 기본 모델 `claude-sonnet-5-5`, `AbortSignal.timeout(15000)`)로 호출.
  - `interface Facts { numbers: number[]; dates: IsoDate[] }`; `verifyFacts(text: string, facts: Facts): { ok: boolean; unmatched: string[] }` — 문장 속 숫자(쉼표·소수·`%`·`억`/`만`/`원` 단위 환산)와 날짜(`YYYY-MM-DD`)를 추출해 `facts`와 상대오차 0.5% 이내로 대조.
  - `interface AssistResult { text: string; source: 'ai' | 'template'; note: string }` (`note`: `'AI 미사용'` / `'AI 문장 숫자 불일치: 미반영'` / `''`)
  - `summarizeForApproval(detail: CaseDetail, ai: AiProvider | null): Promise<AssistResult>`, `draftInfoRequest(needed: string, detail: CaseDetail, ai: AiProvider | null): Promise<AssistResult>`, `structureReply(text: string, ai: AiProvider | null): Promise<{ candidates: { cashOutflowDate?: IsoDate; annualFixedFeeKrw?: number }; source: 'ai'|'template'; note: string }>` — 후보일 뿐이며 사람이 확인해야 서비스에 반영된다.
  - 세 함수 모두 호출 예외·타임아웃·숫자 불일치 시 규칙 기반 템플릿으로 대체한다. 프롬프트에는 해당 건의 사실값만 넣는다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `verify.test.ts`: `'고정 피 28억 원'` vs `facts.numbers=[2_800_000_000]` ok / `'35억 원'`은 `unmatched:['35억']` / `'2026-07-17'`만 `dates`에 있으면 통과, 없는 날짜는 불일치 / `'실질 ROAS -0.21'`과 `facts.numbers=[-0.2149]` 허용 오차 내 ok / 쉼표 숫자 `'180,803,272원'` ok.
  - `assist.test.ts`(가짜 provider 주입): provider가 `null`이면 `source:'template'`, `note:'AI 미사용'` / 가짜가 엔진에 없는 숫자를 쓰면 템플릿으로 대체 + `'AI 문장 숫자 불일치: 미반영'` (Review Focus 4) / 가짜가 throw해도 템플릿 / 정상 문장이면 `source:'ai'` / `structureReply('지급일은 2026-08-10입니다')` → `candidates.cashOutflowDate === '2026-08-10'`, 날짜가 없는 문장은 `candidates` 비어 있음.
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 템플릿 문장은 서비스 `CaseDetail`의 값(경로·근거·기한·하회 구간·실질 ROAS)만 채워 만든다. 숫자 대조 대상 `Facts`는 같은 `CaseDetail`에서 만든다.
- [ ] **Step 4: 실행해 통과 확인** — `npm test` PASS. 실제 키 호출은 자동 테스트에 넣지 않는다.
- [ ] **Step 5: 커밋** — `git commit -m "feat(ai): add provider adapter, number verification and template fallbacks"`

---

### Task 9: 화면 4개와 역할 전환

**Files:**
- Create: `app/(shell)/layout.tsx`(상단 바: 업무 기준일·현재 업무일·역할 전환·시나리오 표시), `app/(shell)/page.tsx`(오늘 결정할 것), `app/(shell)/cases/[id]/page.tsx`, `app/(shell)/requests/page.tsx`, `app/(shell)/settings/page.tsx`, `app/actions.ts`(서버 액션), `app/components/*`
- Modify: `app/globals.css`, `app/page.tsx`(Task 3의 임시 페이지 제거)
- Test: `tests/web/actions.test.ts`

**Interfaces:**
- Consumes: `IntakeService`, `summarizeForApproval`, `draftInfoRequest`, `structureReply`.
- Produces: 서버 액션 `setRole(role)`(쿠키), `actConfirmFinance|actSubmit|actDecide|actResubmit|actClose|actReply|actProposeChange|actAdvanceClock|actSetScenario|actReset` — 각각 서비스 호출 후 `revalidatePath`. 오류는 화면 상단 알림으로 보여 주고 상태를 바꾸지 않는다.

화면 요구(명세 7장):
- **오늘 결정할 것**: 업무 기준일, 하회 구간 배너(구간 여러 개면 모두), 실효 기한 카운트다운 카드(D-14/7/3/경과 색 구분), 건 목록(실효 기한순, 경로 뱃지, 이슈 코드, 명목 순위 vs 실질 순위), 연결 그룹 경고, 현재 역할이 결정할 수 있는 건 강조.
- **건 상세**: 접수표 6개 구역, 이력(모의 표시 포함), 연결 그룹, 버튼 승인/거절/보류(현재 역할이 결재자일 때만 활성). 보류 폼은 담당 역할·기한 필수. D-3 에스컬레이션 시 선택지 3개 표시. "AI 상신 요약" 영역(출처·`note` 표시, 숫자 불일치 시 템플릿 문장과 사유). CEO_BOARD 건에는 이사회 2026-07-06 표시.
- **확인 요청함**: 담당·기한이 붙은 요청 목록, AI 요청서 초안, 모의 회신 입력(유리/불리/지연 빠른 입력 버튼 포함)과 AI 구조화 후보 확인 후 반영.
- **가정·기준값**: 시나리오 5종 전환, 가정 라벨(확정/벤치마크/가정), C층 기준값, 업무 시계 진행 폼, 초기화 버튼, "실제 작동 / 모의 / 설계 단계" 표(명세 11장).
- 표본 금액에 곱한 절감 금액은 표시하지 않고, 풀스케일 금액(28억)과 표본 금액은 나란히만 놓는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/web/actions.test.ts`): `actDecide`가 결재 권한 없는 역할이면 상태가 바뀌지 않고 오류를 반환 / `actAdvanceClock`에 과거 날짜 → 오류 / `actReset` 후 상태 26건 `finance_review`. (서버 액션은 서비스 호출 래퍼로 만들어 테스트 가능하게 한다.)
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 서버 컴포넌트 + 서버 액션 중심, 클라이언트 컴포넌트는 폼 상태가 필요한 곳에만. 스타일은 `globals.css` 한 파일(외부 UI 라이브러리 없음). 색만으로 의미를 전달하지 않고 텍스트 뱃지를 함께 쓴다.
- [ ] **Step 4: 검증** — `npm test` PASS, `npm run build` 성공. 내장 브라우저로 `npm run dev` 화면을 열어: (a) 첫 화면에 26건과 하회 구간 배너 `2026-07-21~2026-08-21`, CEO 13/대표 13 뱃지, (b) 혜인 전속계약 상세에서 이사회 날짜·"금액 판단 유보" 문구, (c) 보류 폼에서 기한을 비우면 제출이 막힘, (d) 가정 화면에서 LC-0001 45일 전환 시 CEO 뱃지가 계약 1건만 남는지 확인하고 확인한 내용을 보고한다.
- [ ] **Step 5: 커밋** — `git commit -m "feat(web): add decision, request, and settings screens with role switching"`

---

### Task 10: 시연 3건 재현과 초기화

**Files:**
- Create: `scripts/demo.ts`, `tests/demo/scenarios.test.ts`
- Modify: `package.json`(`"demo": "tsx scripts/demo.ts"`)

**Interfaces:**
- Consumes: `IntakeService`(모든 시연은 서비스 공개 메서드만 호출).
- Produces: `runScenario(service, 'normal' | 'change' | 'shortage'): Promise<ScenarioReport>`(단계별 실행 내용과 확인 값을 담은 로그). CLI: `npm run demo -- normal|change|shortage|all`은 시나리오 전에 `reset()`하고 보고를 출력.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/demo/scenarios.test.ts`, 서비스 메서드 호출 기준; 명세 9장 값):
  - `normal`: 이슈 코드 `LOSS` 캠페인 6건(CMP-0001·0002·0003·0012·0013·0014), `EXECUTION_BEFORE_DEADLINE` 12건, 하회 구간 안 12건+전속계약이 `CEO_BOARD`(이사회 2026-07-06 표시), 나머지 13건 `MASIL_CEO_GROUP_REPORT`, 혜인(INF-001)·Ava Glow 연결 그룹.
  - `change` (연 18억): 여전히 `CEO_BOARD`, 위약금 갱신 직후 해지 기준 900,000,000. (연 9억): `MASIL_CEO` + `cash_outflow_date` 확인 요청 생성, "금액 판단 유보" 노트, 이력에 `simulated: true`. 회신 `2026-08-10` → `CEO_BOARD`, `2026-09-30` → `MASIL_CEO`. 민감도: `lc45` 전환 시 `CEO_BOARD`는 전속계약 1건뿐.
  - `shortage`: 전속계약 보류(담당 `finance`, 기한 있음) → `advanceClock('2026-07-14')`에서 D-3 에스컬레이션(선택지 3개) → 유리/불리/지연 회신 각각의 결과 → 별도 실행에서 CEO 거절 → 재상신. 연결 그룹 경고: 혜인 기안 거절+계약 미결정이면 "기안만 부결, 계약은 자동 갱신" 경고.
  - `reset restores the initial state` (시나리오 실행 뒤 `reset()` → 26건 `finance_review`, 시계 2026-07-01, 이력은 접수·계산만).
- [ ] **Step 2: 실행해 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 시나리오 함수는 위 검증에 필요한 서비스 호출 순서를 한 곳에 모은다(화면 재현 절차와 동일해야 함).
- [ ] **Step 4: 검증** — `npm test` PASS, `npm run demo -- all` 출력에서 각 시나리오의 확인 값이 위와 같은지 눈으로 대조해 보고한다.
- [ ] **Step 5: 커밋** — `git commit -m "feat(demo): add reproducible three-case scenarios with reset"`

---

### Task 11: 배포 전환 (사용자 승인 게이트)

**Files:**
- Modify: `axhub.yaml`, `README.md`
- 이 작업은 **배포 설정 변경과 push를 포함하므로 각 단계 시작 전에 사용자의 명시적 허락을 받는다.** 허락 전에는 로컬 검증까지만 한다.

- [ ] **Step 1: 설정 방법 확인** — `axhub:deploy` 스킬과 `axhub` CLI 도움말로 서버 앱(Next.js) 배포의 `axhub.yaml` 필드(빌드·시작 명령, `PORT`, `0.0.0.0`, 헬스체크 경로, `database.engine: postgres`)를 읽기 전용으로 확인하고, 현재 `deploy_method: static`/`static_output_dir: public`과 무엇이 달라지는지 사용자에게 보고한다.
- [ ] **Step 2: 로컬 운영 모드 검증** — `NODE_ENV=production`에서 `DATABASE_URL` 없이 시작하면 오류로 멈추는지 확인(운영 모드에서 메모리 DB로 조용히 동작하면 안 됨). 실제 Postgres 접속 검증은 사용자가 `DATABASE_URL`을 제공한 뒤에만 한다. `npm run build && PORT=3100 npm start` 후 `/api/health` 200.
- [ ] **Step 3 (사용자 허락 필요): 설정 변경** — `axhub.yaml`을 서버 앱 방식으로 바꾸고 `README.md`에 실행·환경변수(`DATABASE_URL`, 선택 `ANTHROPIC_API_KEY`는 사용자가 직접 `axhub env set ... --secret --from-stdin`으로 등록) 안내를 적는다. 커밋: `git commit -m "chore(deploy): switch axhub app from static to Next.js server"`
- [ ] **Step 4 (사용자 허락 필요): 배포와 확인** — 사용자가 고른 방식(`main` 병합 후 push, 또는 다른 경로)으로 배포하고, 배포 주소에서 `/api/health`, 첫 화면, `npm run demo` 상당 시연 3건을 화면에서 재현해 결과를 보고한다. 실패하면 `axhub:diagnosis`로 원인을 읽기 전용으로 확인한다. 기존 정적 사이트가 사라질 수 있다는 점을 허락 전에 알린다.

---

### Task 12: A04 제출 문서 초안과 재현 절차

**Files:**
- Create: `docs/submission/a04-draft.md`, `docs/submission/reproduce.md`

- [ ] **Step 1: A04 초안** — `01_참가자_배포용/A04.html`의 6개 섹션(1 문제와 전문성 확장 요약, 2 업무모델과 데이터 설명, 3 대표 실행 사례, 4 추가 확장 목록, 5 실행·재현 방법, 6 제출 전 자기점검) 순서대로 채운다. 근거는 명세 2·5·9·11·13장, 테스트 이름, 화면 위치, `scripts/demo.ts` 출력. 실제 작동/모의/설계 단계를 명세 11장 표와 일치시킨다. **"본인의 관심·전문성"과 필수 전문성 확장의 개인 서술은 `[사용자 작성]`으로 비워 두고 대신 쓰지 않는다.** 제출 형식·제출처·일정은 `[별도 운영 공지 확인]`으로 둔다.
- [ ] **Step 2: 재현 절차** (`reproduce.md`) — 설치(`npm ci`), 데이터 위치, `npm test`, `npm run demo -- all`, 화면에서의 입력값·순서(업무 시계 7/14 진행, 모의 회신 입력), 초기화 방법, 현재 제약(AI 키 미등록 시 "AI 미사용" 표시, 배포 주소 상태)을 실제 실행해 본 그대로 적는다.
- [ ] **Step 3: 자기점검** — 6장 체크 항목마다 증거 위치(테스트·화면·문서)를 한 줄씩 연결하고, 증거가 없는 항목은 비워 두지 말고 "미충족"으로 표시해 사용자에게 보고한다.
- [ ] **Step 4: 커밋** — `git add docs/submission && git commit -m "docs: add A04 submission draft and reproduction guide"`

---

## 계획 2 완료 기준

- `npm test` 전부 통과(엔진 53개 + 신규), `npm run build` 성공, 원본 폴더 변경 없음.
- 명세 13장 보류 항목 4개가 모두 해결로 표시됨.
- 로컬 화면에서 시연 3건이 재현되고, 결정·보류·회신·시계 진행이 DB 상태·이력·확인 요청을 실제로 바꾼다.
- 배포(Task 11)는 사용자 허락 후에만 진행하며, 배포 주소 재현 결과를 보고한다.
- A04 초안의 사용자 작성 칸은 비어 있고 그 사실이 보고됨.
