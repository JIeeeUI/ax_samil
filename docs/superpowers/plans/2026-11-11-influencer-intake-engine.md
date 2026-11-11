# 인플루언서 제안 접수·판정 엔진 Implementation Plan (계획 1: 토대 + 뼈대)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 데이터룸을 읽어 실질 성과·현금 하회 구간·승인 경로·실효 결정 기한·이슈를 계산하고, 마케팅·재무가 바로 쓰는 제안 접수표(CSV)를 출력하는 TypeScript 계산 엔진을 만든다.

**Architecture:** 순수 함수 모듈(`src/engine/*`)이 원본 CSV를 읽기 전용으로 적재하고 계산한다. 표본 계열과 풀스케일 계열은 서로 다른 타입으로 적재해 함수 시그니처 수준에서 섞이지 않게 한다. CLI(`scripts/intake.ts`)가 가정 세트를 골라 접수표 CSV를 `outputs/`에 쓴다. 계획 2(웹 결재 흐름)는 이 엔진을 그대로 가져다 쓴다.

**Tech Stack:** Node 24, TypeScript 5 (strict), Vitest, tsx. 외부 런타임 의존성 없음(CSV 파서는 직접 작성 — 원본은 파이프 구분, 값 안에 파이프·따옴표 없음).

**Spec:** `docs/superpowers/specs/2026-11-11-influencer-intake-design.md` (배경: `pre.md`)

## 0단계 확인 결과 (2026-11-11, 읽기 전용)

- axhub(lounge): 템플릿은 Next.js App Router. DB는 PostgreSQL만(`axhub.yaml`의 `database.engine: postgres` → `DATABASE_URL`, 마이그레이션은 `DIRECT_DATABASE_URL`). 컨테이너 파일·SQLite 영구 보관 금지. 포트는 `PORT`, `0.0.0.0`, 헬스체크 경로 필요.
- AI: AXRouter `available: false` → AI 호출은 사용자 본인 키(`ANTHROPIC_API_KEY`)를 사용자가 직접 비밀 환경변수로 등록해야 함. 등록 전에는 규칙 기반 템플릿으로 대체(명세 10장).
- 로컬: Node v24.22.1, npm 11.19.1 사용 가능. Python 3.14는 pip 없음, Docker 없음.
- 결정: 엔진·웹 모두 TypeScript. 엔진은 Node만으로 동작하고 DB에 의존하지 않는다.

## Global Constraints

- 원본 폴더 `01_참가자_배포용/04_원본데이터`는 읽기 전용. 쓰기 금지, 파일 해시 불변(Task 1·7 테스트).
- `.claude`, `.codex`, `.agents` 폴더와 `.gitignore`는 수정 금지. 무시 규칙이 필요하면 `.git/info/exclude`에 쓴다.
- 모든 커밋 직전 `git check-ignore .claude/settings.local.json .codex/hooks.json .agents/hooks.json`가 세 줄을 모두 출력하는지 확인한다. 하나라도 안 나오면 커밋하지 않는다.
- 데이터 경로는 `DATA_DIR` 환경변수(기본값 `01_참가자_배포용/04_원본데이터`, 저장소 루트 기준).
- CSV 입력: UTF-8(BOM 있으면 제거), 파이프 `|` 구분, 첫 행 헤더, CRLF/LF 모두 허용, `NONE` → `null`(0 아님).
- 금액은 원(KRW) 정수, 날짜는 `YYYY-MM-DD` 문자열(`IsoDate`). 업무 기준일 `2026-07-01`, 현금 기초 잔액은 `fin_cash_daily_ms`의 `2026-06-30` 종가 `5148063540`.
- 계산 정의는 A05 우선: 공헌이익 = (GMV − 반품환불) − 제품원가 − 채널수수료 − 출고 물류비 − 반품 물류비 − Marketing Spend. 쿠폰·환불을 다시 빼지 않는다. Marketing Spend = `ad_cost_krw` 합(`influencer_fee_krw`는 이미 포함).
- 표본 계열(`mkt_*`, 예산기안)과 풀스케일 계열(`fin_*`, `sc_purchase_orders_ms`, 전속계약 금액)은 절대금액으로 더하지 않는다. 기안 금액은 승인 한도 판정에만 쓴다.
- 승인 한도: 건별 `10000000` 초과, 기안 총액 `100000000` 초과, 전속계약 연 `1000000000` 초과. covenant 최소 `3000000000`(영업일 기준, 미만이면 하회).
- 이사회 `2026-07-06`. 전속계약(INF-001): 고정 피 연 `2800000000`, 통보 기한 `2026-07-17`, 만료 `2026-08-31`, 현금 유출일 미확인(`null`).
- 모든 가정 값에는 라벨 `'confirmed' | 'benchmark' | 'assumption'`을 붙인다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. `NONE`이 들어간 숫자·코드 열(`influencer_fee_krw`, `po_id`) — `null`로 읽혀야 하며 0이나 `NaN`이 되면 안 된다. (Task 1 테스트)
2. 광고비가 0인 캠페인 — ROAS가 `Infinity`가 아니라 `null`(계산 불가)이어야 한다. (Task 3 테스트)
3. 기한·지급일이 주말이거나 기준일 이전인 일정 — 다음 영업일 / 기준일로 옮겨져야 한다. (Task 4 테스트)
4. 현금 유출일이 없는 건(전속계약) — 실효 기한은 확정기한, 승인 경로는 "정보 필요"를 남겨야 한다. (Task 5 테스트)
5. 출력 CSV를 엑셀에서 열 때 한글 깨짐 — 출력은 UTF-8 BOM으로 시작하고 한글 헤더를 가져야 한다. (Task 7 테스트)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | 프로젝트 설정. `npm test` = `tsc --noEmit && vitest run` |
| `src/engine/types.ts` | 공용 타입(`IsoDate`, 행 타입, `DataRoom`) |
| `src/engine/csv.ts` | 파이프 CSV 파서 |
| `src/engine/dataRoom.ts` | 원본 적재 + SHA-256 해시 |
| `src/engine/calendar.ts` | 날짜·영업일 계산 |
| `src/engine/assumptions.ts` | 가정 세트, 시나리오 프리셋, 라벨 |
| `src/engine/performance.ts` | 캠페인·인플루언서 실질 성과 |
| `src/engine/cash.ts` | 현금 시뮬레이션, 하회 구간 |
| `src/engine/cases.ts` | 제안 건, 실효 결정 기한, 연결 그룹, 기한 알림 단계 |
| `src/engine/routing.ts` | 승인 경로 판정 |
| `src/engine/issues.ts` | 기준점 판정(이슈 생성) |
| `src/engine/intake.ts` | 접수표 행 조립, CSV 직렬화 |
| `scripts/intake.ts` | CLI |
| `tests/engine/*.test.ts` | 단위·정답 기준 테스트 |
| `tests/engine/scale.typecheck.ts` | 표본·풀스케일 혼용 컴파일 오류 검증 |
| `outputs/` | 제출용 접수표 CSV(커밋 대상) |

---

### Task 1: 프로젝트 골격과 원본 적재

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/engine/types.ts`, `src/engine/csv.ts`, `src/engine/dataRoom.ts`
- Modify: `.git/info/exclude` (`node_modules/`, `.next/` 추가 — `.gitignore`는 건드리지 않음)
- Test: `tests/engine/csv.test.ts`, `tests/engine/dataRoom.test.ts`

**Interfaces:**
- Produces:
  - `parsePipeCsv(text: string): Record<string, string | null>[]` — BOM 제거, CRLF/LF, `NONE`→`null`
  - `loadDataRoom(dataDir?: string): DataRoom`
  - `hashDataFiles(dataDir?: string): Record<string, string>` — 상대경로 → SHA-256 hex
  - `DataRoom = { masters: { campaigns, influencers, channels, skus }, sample: SampleTables, full: FullTables, benchmarks: { channel, industry } }`
    - `SampleTables = { orders, returns, coupons, adSpend, costMaster, budgetPlan }`
    - `FullTables = { cashDaily, arAging, apAging, purchaseOrders, cashForecast }`
    - 행 필드명은 CSV 열 이름 그대로, 금액·수량·퍼센트 열은 `number`, `NONE`은 `null`, 불리언 열(`stacked_flag`, `reorder_within_90d` 등)은 `boolean`.

- [ ] **Step 1: 설정 파일 작성과 의존성 설치**

`package.json` scripts: `"test": "tsc --noEmit && vitest run"`, `"intake": "tsx scripts/intake.ts"`. devDependencies: `typescript`, `vitest`, `tsx`, `@types/node`. `tsconfig.json`: `strict: true`, `module`/`moduleResolution: "NodeNext"`, `include: ["src", "scripts", "tests"]`.
Run: `npm install` — Expected: 오류 없이 완료. `.git/info/exclude`에 `node_modules/`, `.next/` 두 줄 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/engine/csv.test.ts
test('parses pipe CSV with BOM, CRLF and NONE', () => {
  const rows = parsePipeCsv('﻿a|b|c\r\n1|NONE|x\r\n2|3|y\r\n');
  expect(rows).toEqual([{ a: '1', b: null, c: 'x' }, { a: '2', b: '3', c: 'y' }]);
});

// tests/engine/dataRoom.test.ts
const room = loadDataRoom();
test('row counts', () => {
  expect(room.sample.orders).toHaveLength(15650);
  expect(room.sample.returns).toHaveLength(1719);
  expect(room.sample.budgetPlan).toHaveLength(25);
  expect(room.masters.campaigns).toHaveLength(25);
  expect(room.masters.influencers).toHaveLength(10);
  expect(room.full.purchaseOrders).toHaveLength(14);
});
test('NONE becomes null, not 0', () => {
  const perf = room.sample.adSpend.find(r => r.media === '퍼포먼스')!;
  expect(perf.influencer_fee_krw).toBeNull();
  expect(room.full.apAging.filter(r => r.po_id === null)).toHaveLength(10);
});
test('opening balance row', () => {
  const last = room.full.cashDaily.at(-1)!;
  expect(last.date).toBe('2026-06-30');
  expect(last.closing_balance).toBe(5148063540);
});
test('loading does not modify raw files', () => {
  const before = hashDataFiles();
  loadDataRoom();
  expect(hashDataFiles()).toEqual(before);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/engine/csv.test.ts tests/engine/dataRoom.test.ts` — Expected: FAIL (모듈 없음)

- [ ] **Step 4: `parsePipeCsv`, `loadDataRoom`, `hashDataFiles` 구현**

`loadDataRoom`은 `node:fs` `readFileSync`만 사용(쓰기 API 사용 금지). 파일 목록은 명세 4장 입력 파일과 같다. 숫자 변환은 열 이름 목록으로 명시(`*_krw`, `*_qty`, `*_pct`, `*_days`, `impressions` 등).

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test` — Expected: PASS

- [ ] **Step 6: 커밋** (Global Constraints의 check-ignore 확인 후)

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/engine/types.ts src/engine/csv.ts src/engine/dataRoom.ts tests/engine/csv.test.ts tests/engine/dataRoom.test.ts
git commit -m "feat(engine): load data room read-only with pipe CSV parser"
```

---

### Task 2: 날짜 계산과 가정 세트

**Files:**
- Create: `src/engine/calendar.ts`, `src/engine/assumptions.ts`
- Test: `tests/engine/calendar.test.ts`, `tests/engine/assumptions.test.ts`

**Interfaces:**
- Produces:
  - `addDays(d: IsoDate, n: number): IsoDate`, `daysBetween(from: IsoDate, to: IsoDate): number`(달력일), `isBusinessDay(d: IsoDate): boolean`(월~금), `nextBusinessDay(d: IsoDate): IsoDate`(이미 영업일이면 그대로), `businessDaysInRange(from: IsoDate, to: IsoDate): IsoDate[]`, `minDate(a: IsoDate, b: IsoDate | null): IsoDate`
  - `type Label = 'confirmed' | 'benchmark' | 'assumption'`
  - `interface AssumptionSet { id: ScenarioId; version: string; unitsPerOrder: number; channelFeeBasis: 'gmv' | 'net'; recoverCostOnRefund: boolean; calcMode: 'a05' | 'literal-calc-def'; overdueAr: 'asof' | 'exclude'; overdueAp: 'asof' | 'exclude'; lc0001TermsDays: 90 | 45; asOf: IsoDate; labels: Record<string, Label> }`
  - `type ScenarioId = 'baseline' | 'arOverdueExcluded' | 'apOverdueExcluded' | 'bothOverdueExcluded' | 'lc45'`
  - `SCENARIOS: Record<ScenarioId, AssumptionSet>`, `DEFAULT_ASSUMPTIONS = SCENARIOS.baseline`
  - `THRESHOLDS` 상수: `{ perItemKrw: 10000000, planTotalKrw: 100000000, contractAnnualKrw: 1000000000, covenantMinKrw: 3000000000, returnIssuePp: 3, minOrders: 100, alertDays: [14, 7, 3], boardDate: '2026-07-06' }` + 각 항목 라벨

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('weekend rolls to Monday', () => {
  expect(nextBusinessDay('2026-08-23')).toBe('2026-08-24'); // 일요일
  expect(nextBusinessDay('2026-07-21')).toBe('2026-07-21');
});
test('calendar days', () => { expect(daysBetween('2026-07-01', '2026-07-17')).toBe(16); });
test('baseline assumptions', () => {
  expect(DEFAULT_ASSUMPTIONS).toMatchObject({ unitsPerOrder: 1, channelFeeBasis: 'gmv', recoverCostOnRefund: false, calcMode: 'a05', overdueAr: 'asof', overdueAp: 'asof', lc0001TermsDays: 90, asOf: '2026-07-01' });
  expect(SCENARIOS.lc45.lc0001TermsDays).toBe(45);
  expect(THRESHOLDS.covenantMinKrw).toBe(3000000000);
});
test('every assumption field has a label', () => {
  for (const s of Object.values(SCENARIOS)) expect(Object.keys(s.labels).sort()).toEqual(['calcMode','channelFeeBasis','lc0001TermsDays','overdueAp','overdueAr','recoverCostOnRefund','unitsPerOrder']);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/calendar.test.ts tests/engine/assumptions.test.ts` — Expected: FAIL

- [ ] **Step 3: 구현** — 날짜는 UTC 기준 `Date`로 계산해 시간대 영향 없게 한다. `lc0001TermsDays` 라벨은 90일=`confirmed`, 45일=`assumption`.

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/calendar.ts src/engine/assumptions.ts tests/engine/calendar.test.ts tests/engine/assumptions.test.ts
git commit -m "feat(engine): add business calendar and labeled assumption sets"
```

---

### Task 3: 실질 성과

**Files:**
- Create: `src/engine/performance.ts`
- Test: `tests/engine/performance.test.ts`

**Interfaces:**
- Consumes: `DataRoom`(masters, sample, benchmarks), `AssumptionSet`
- Produces:
  - `interface CampaignPerf { campaignId: string; influencerId: string; salesChannelType: string; orders: number; gmv: number; refunds: number; couponDiscount: number; contributionBeforeSpend: number; spend: number; nominalRoas: number | null; realRoas: number | null; returnRate: number | null; discountRate: number | null }`
  - `interface InfluencerPerf { influencerId: string; name: string; feeType: string; tier: string; spend: number; spendShare: number; requested: number; requestShare: number; gmv: number; realRoas: number | null; nominalRoas: number | null; realRank: number }` (realRank 1 = 가장 높음)
  - `computeCampaignPerformance(room: Pick<DataRoom,'masters'|'sample'>, a: AssumptionSet): CampaignPerf[]`
  - `computeInfluencerPerformance(room: Pick<DataRoom,'masters'|'sample'>, a: AssumptionSet): InfluencerPerf[]`
  - `returnRateByChannelType(room: Pick<DataRoom,'masters'|'sample'>): Record<string, number>`
  - 정의: 주문별 `fee = (basis === 'gmv' ? gmv : gmv - refund) × channel_fee_pct / 100`, `productCost = product_cost_krw × unitsPerOrder`; `recoverCostOnRefund`이면 반품 주문의 제품원가·수수료 0; `calcMode === 'literal-calc-def'`이면 주문별로 `coupon_discount_krw + refund`를 추가로 뺀다(회귀 검증용). `realRoas = (contributionBeforeSpend − spend) / spend`, spend 0이면 `null`. `returnRate = refunds / gmv`, `discountRate = couponDiscount / (gmv + couponDiscount)`. `salesChannelType`은 `m_campaign_ms.sales_channel`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const NEG6 = ['CMP-0001','CMP-0002','CMP-0003','CMP-0012','CMP-0013','CMP-0014'];
const neg = (a: AssumptionSet) => computeCampaignPerformance(room, a).filter(c => c.realRoas! < 0).map(c => c.campaignId).sort();

test('baseline: six loss-making campaigns', () => { expect(neg(DEFAULT_ASSUMPTIONS)).toEqual(NEG6); });
test('robust to cost assumptions', () => {
  for (const v of [{channelFeeBasis:'net'}, {recoverCostOnRefund:true}, {channelFeeBasis:'net', recoverCostOnRefund:true}] as const)
    expect(neg({ ...DEFAULT_ASSUMPTIONS, ...v })).toEqual(NEG6);
});
test('literal calc-def double subtraction gives 11 (regression: engine must not use it by default)', () => {
  expect(neg({ ...DEFAULT_ASSUMPTIONS, calcMode: 'literal-calc-def' })).toEqual(
    ['CMP-0001','CMP-0002','CMP-0003','CMP-0007','CMP-0008','CMP-0012','CMP-0013','CMP-0014','CMP-0017','CMP-0018','CMP-0019']);
});
test('influencer real ROAS and shares', () => {
  const by = Object.fromEntries(computeInfluencerPerformance(room, DEFAULT_ASSUMPTIONS).map(i => [i.influencerId, i]));
  // 사전 계산은 소수 둘째 자리(ROAS)·퍼센트 첫째 자리(비중)까지만 확인했으므로 그 정밀도로 고정
  expect(by['INF-001'].realRoas).toBeCloseTo(-0.20, 1);
  expect(by['INF-005'].realRoas).toBeCloseTo(-0.21, 1);
  expect(by['INF-002'].realRoas).toBeCloseTo(3.70, 1);
  expect(by['INF-001'].realRoas!).toBeLessThan(0);
  expect(by['INF-001'].spendShare).toBeCloseTo(0.406, 2);
  expect(by['INF-005'].spendShare).toBeCloseTo(0.221, 2);
  expect(by['INF-001'].requestShare).toBeCloseTo(0.280, 2);
  expect(by['INF-003'].requestShare).toBeCloseTo(0.151, 2);
});
test('return rate by channel type', () => {
  const r = returnRateByChannelType(room);
  expect(r['자사몰']).toBeCloseTo(0.040, 2);
  expect(r['마켓플레이스']).toBeCloseTo(0.099, 2);
  expect(r['대형파트너']).toBeCloseTo(0.129, 2);
  expect(r['라이브']).toBeCloseTo(0.130, 2);
});
test('zero spend gives null ROAS, not Infinity', () => {
  const r = computeCampaignPerformance({ ...room, sample: { ...room.sample, adSpend: room.sample.adSpend.filter(a => a.campaign_id !== 'CMP-0004') } }, DEFAULT_ASSUMPTIONS)
    .find(c => c.campaignId === 'CMP-0004')!;
  expect(r.realRoas).toBeNull(); expect(r.nominalRoas).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/performance.test.ts` — Expected: FAIL

- [ ] **Step 3: 구현** — 위 Interfaces의 정의대로. 조인 키: 주문 `(sku_id, channel_id)` → 원가마스터, 주문 `order_id` → 반품(1:0..1), `campaign_id` → 캠페인 → `influencer_id`. `requested`는 `budgetPlan`을 캠페인 경유로 인플루언서별 합산.

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/performance.ts tests/engine/performance.test.ts
git commit -m "feat(engine): compute real contribution and ROAS per A05"
```

---

### Task 4: 현금 시뮬레이션

**Files:**
- Create: `src/engine/cash.ts`
- Test: `tests/engine/cash.test.ts`, `tests/engine/scale.typecheck.ts`

**Interfaces:**
- Consumes: `FullTables`, `AssumptionSet`, `calendar`
- Produces:
  - `interface CashResult { opening: number; daily: { date: IsoDate; balance: number }[]; breach: { start: IsoDate; end: IsoDate; businessDays: number } | null; minimum: { date: IsoDate; balance: number }; officialMinClosing: number }`
  - `simulateCash(full: FullTables, a: AssumptionSet, horizonEnd: IsoDate = '2026-09-30'): CashResult`
  - `isInBreach(date: IsoDate, breach: CashResult['breach']): boolean` (양 끝 포함)
  - `checkActualIdentity(full: FullTables): { date: IsoDate; diff: number }[]` (항등식이 깨진 날만 반환)
  - 규칙: 기초 = 마지막 `cashDaily.closing_balance`. 회수 = AR `outstanding_krw`를 `due_date`에(기준일 전이면 `overdueAr`에 따라 기준일 또는 제외), LC-0001(`channel_id === 'CH-03'`)은 `lc0001TermsDays === 45`면 `invoice_date + 45`. 지급 = AP 중 `po_id === null`인 행의 `amount_krw`를 `payment_due_date`에(기준일 전이면 `overdueAp`에 따라), 발주 = `purchaseOrders.amount_krw`를 `payment_due_date`에. 모든 일정은 `nextBusinessDay`로 이월. 영업일마다 잔액 갱신. 하회 = `balance < covenantMinKrw`. `officialMinClosing` = `cashForecast.projected_closing_krw` 최소값.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const R = (id: ScenarioId) => simulateCash(room.full, SCENARIOS[id]);
test('actual period identity holds', () => { expect(checkActualIdentity(room.full)).toEqual([]); });
test('baseline breach window', () => {
  const r = R('baseline');
  expect(r.opening).toBe(5148063540);
  expect(r.breach).toEqual({ start: '2026-07-21', end: '2026-08-21', businessDays: 24 });
  expect(r.minimum).toEqual({ date: '2026-07-27', balance: 1647835595 });
  expect(r.officialMinClosing).toBe(5468884369);
});
test('scenario sensitivity', () => {
  expect(R('arOverdueExcluded').breach).toEqual({ start: '2026-07-21', end: '2026-08-28', businessDays: 29 });
  // 사전 계산은 억 단위 소수 둘째 자리 반올림값만 확인했으므로 0.05억 허용
  expect(R('arOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(14.68, 1);
  expect(R('apOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(21.02, 1);
  expect(R('bothOverdueExcluded').minimum.balance / 1e8).toBeCloseTo(19.22, 1);
  expect(R('lc45').breach).toBeNull();
  expect(R('lc45').minimum.date).toBe('2026-07-22');
  expect(R('lc45').minimum.balance / 1e8).toBeCloseTo(48.35, 1);
});
test('weekend collections roll to Monday', () => {
  // LC-0001 회수 예정 2026-08-23(일) → 08-24에 반영되어 그날 하회가 끝난다
  const r = R('baseline');
  expect(r.daily.find(d => d.date === '2026-08-24')!.balance).toBeGreaterThanOrEqual(3000000000);
  expect(r.daily.some(d => d.date === '2026-08-23')).toBe(false);
});
```

```ts
// tests/engine/scale.typecheck.ts — npm test의 tsc 단계에서 검증됨
import { simulateCash } from '../../src/engine/cash';
declare const room: DataRoom;
// @ts-expect-error 표본 계열은 현금 시뮬레이션에 넣을 수 없다
simulateCash(room.sample, DEFAULT_ASSUMPTIONS);
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/cash.test.ts` — Expected: FAIL

- [ ] **Step 3: 구현** — Interfaces의 규칙대로. `FullTables`와 `SampleTables`는 구조적으로 겹치지 않게 필드명을 둔다(위 typecheck가 실제로 오류를 내야 함).

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS (`tsc --noEmit`이 `@ts-expect-error`를 소비해야 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/cash.ts tests/engine/cash.test.ts tests/engine/scale.typecheck.ts
git commit -m "feat(engine): simulate 90-day cash and covenant breach window"
```

---

### Task 5: 제안 건, 실효 결정 기한, 승인 경로

**Files:**
- Create: `src/engine/cases.ts`, `src/engine/routing.ts`
- Test: `tests/engine/cases.test.ts`, `tests/engine/routing.test.ts`

**Interfaces:**
- Consumes: `DataRoom`, `CashResult['breach']`, `THRESHOLDS`, `calendar`
- Produces:
  - `interface Case { id: string; kind: 'plan' | 'contract'; influencerId: string; campaignId: string | null; amount: number; amountScale: 'sample' | 'full'; deadline: IsoDate; settlementDate: IsoDate | null; cashOutflowDate: IsoDate | null; effectiveDeadline: IsoDate; executesBeforeDeadline: boolean; expectedGmv: number | null; linkGroup: string }`
  - `buildCases(room: DataRoom, contract?: Partial<ContractTerms>): Case[]` — 기안 25건(`id` = `plan_id`, `amountScale: 'sample'`, `cashOutflowDate = settlementDate`) + 전속계약 1건(`id: 'CONTRACT-INF-001'`, `amount` 기본 2800000000, `amountScale: 'full'`, `settlementDate`·`cashOutflowDate` = `null`). `contract` 인자로 변경 시연의 고정 피(18억/9억)와 회신된 현금 유출일을 넣는다.
  - `interface ContractTerms { annualFixedFeeKrw: number; noticeDeadline: IsoDate; expiry: IsoDate; cashOutflowDate: IsoDate | null }`
  - `effectiveDeadline = minDate(deadline, settlementDate)`, `linkGroup = influencerId`
  - `planTotal(cases: Case[]): number` — `kind === 'plan'`만 합산. 서로 다른 `amountScale`이 섞인 배열을 넘기면 `throw new Error('scale mix')`.
  - `alertStage(today: IsoDate, effectiveDeadline: IsoDate): 'D-14' | 'D-7' | 'D-3' | 'overdue' | null` — `daysBetween` 기준 `<0` overdue, `≤3`, `≤7`, `≤14`
  - `type RouteLevel = 'CEO_BOARD' | 'MASIL_CEO_GROUP_REPORT' | 'MASIL_CEO' | 'MARKETING'`
  - `interface Route { level: RouteLevel; reasons: string[]; needsInfo: string[] }`
  - `routeCase(c: Case, ctx: { breach: CashResult['breach']; planTotal: number }): Route`
  - 규칙(먼저 걸리는 쪽 우선): ① contract && amount > 10억 → CEO_BOARD ② cashOutflowDate가 하회 구간 안 → CEO_BOARD ③ contract(≤10억): cashOutflowDate가 `null`이면 `MASIL_CEO` + `needsInfo: ['cash_outflow_date']`, 아니면 `MASIL_CEO` ④ plan && (amount > 1천만 || planTotal > 1억) → MASIL_CEO_GROUP_REPORT ⑤ 그 외 MARKETING. `reasons`에는 걸린 규칙을 한국어 한 줄로.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const cases = buildCases(room);
const breach = simulateCash(room.full, DEFAULT_ASSUMPTIONS).breach;
const total = planTotal(cases);
test('26 cases, total and links', () => {
  expect(cases).toHaveLength(26);
  expect(total).toBe(180803272);
  expect(cases.filter(c => c.linkGroup === 'INF-005' && c.kind === 'plan').map(c => c.id).sort()).toEqual(['PLAN-005','PLAN-007','PLAN-009']);
});
test('effective deadline pulls 12 plans earlier', () => {
  expect(cases.filter(c => c.executesBeforeDeadline).map(c => c.id).sort()).toEqual(
    ['PLAN-007','PLAN-008','PLAN-009','PLAN-014','PLAN-015','PLAN-016','PLAN-018','PLAN-021','PLAN-022','PLAN-023','PLAN-024','PLAN-025']);
  expect(cases.find(c => c.id === 'PLAN-007')!.effectiveDeadline).toBe('2026-07-17');
  expect(cases.find(c => c.id === 'CONTRACT-INF-001')!.effectiveDeadline).toBe('2026-07-17');
});
test('scale mix throws', () => { expect(() => planTotal([cases[0], { ...cases[0], amountScale: 'full' }])).toThrow('scale mix'); });
test('alert stages', () => {
  expect(alertStage('2026-07-01', '2026-07-17')).toBeNull();
  expect(alertStage('2026-07-03', '2026-07-17')).toBe('D-14');
  expect(alertStage('2026-07-14', '2026-07-17')).toBe('D-3');
  expect(alertStage('2026-07-18', '2026-07-17')).toBe('overdue');
});
test('baseline routing', () => {
  const routes = cases.map(c => [c.id, routeCase(c, { breach, planTotal: total })] as const);
  const ceoPlans = routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'CEO_BOARD');
  expect(ceoPlans).toHaveLength(12);
  expect(ceoPlans.reduce((s, [id]) => s + cases.find(c => c.id === id)!.amount, 0)).toBe(99550557);
  expect(routes.filter(([id, r]) => id.startsWith('PLAN') && r.level === 'MASIL_CEO_GROUP_REPORT')).toHaveLength(13);
  expect(routes.find(([id]) => id === 'CONTRACT-INF-001')![1].level).toBe('CEO_BOARD');
  expect(routes.find(([id]) => id === 'PLAN-021')![1].level).toBe('CEO_BOARD'); // 집행 7/21 = 구간 시작일
});
test('lc45: no plan goes to CEO', () => {
  const b45 = simulateCash(room.full, SCENARIOS.lc45).breach;
  expect(cases.filter(c => c.kind === 'plan' && routeCase(c, { breach: b45, planTotal: total }).level === 'CEO_BOARD')).toHaveLength(0);
});
test('contract fee variants', () => {
  const c18 = buildCases(room, { annualFixedFeeKrw: 1800000000 }).find(c => c.kind === 'contract')!;
  expect(routeCase(c18, { breach, planTotal: total }).level).toBe('CEO_BOARD');
  const c9 = buildCases(room, { annualFixedFeeKrw: 900000000 }).find(c => c.kind === 'contract')!;
  expect(routeCase(c9, { breach, planTotal: total })).toMatchObject({ level: 'MASIL_CEO', needsInfo: ['cash_outflow_date'] });
  const c9in = buildCases(room, { annualFixedFeeKrw: 900000000, cashOutflowDate: '2026-08-03' }).find(c => c.kind === 'contract')!;
  expect(routeCase(c9in, { breach, planTotal: total }).level).toBe('CEO_BOARD');
});
test('threshold boundaries', () => {
  const base = { ...cases[0], kind: 'plan' as const, cashOutflowDate: '2026-09-30' };
  expect(routeCase({ ...base, amount: 10000000 }, { breach, planTotal: 100000000 }).level).toBe('MARKETING');
  expect(routeCase({ ...base, amount: 10000001 }, { breach, planTotal: 100000000 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000 }, { breach, planTotal: 100000001 }).level).toBe('MASIL_CEO_GROUP_REPORT');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-21' }, { breach, planTotal: 1 }).level).toBe('CEO_BOARD');
  expect(routeCase({ ...base, amount: 5000000, cashOutflowDate: '2026-08-24' }, { breach, planTotal: 1 }).level).toBe('MARKETING');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/cases.test.ts tests/engine/routing.test.ts` — Expected: FAIL

- [ ] **Step 3: 구현** — Interfaces의 규칙대로. 전속계약 기본값(고정 피 28억, 기한 7/17, 만료 8/31, 유출일 null)은 `inf001_exclusive_contract_notice.md` 출처 주석과 함께 상수로.

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/cases.ts src/engine/routing.ts tests/engine/cases.test.ts tests/engine/routing.test.ts
git commit -m "feat(engine): build cases with effective deadlines and approval routing"
```

---

### Task 6: 기준점 판정(이슈)

**Files:**
- Create: `src/engine/issues.ts`
- Test: `tests/engine/issues.test.ts`

**Interfaces:**
- Consumes: `CampaignPerf[]`, `InfluencerPerf[]`, `Case[]`, `room.benchmarks.channel`, `THRESHOLDS`
- Produces:
  - `type IssueCode = 'LOSS' | 'RETURN_RATE_WARN' | 'RETURN_RATE_ISSUE' | 'DISCOUNT_ABOVE_AVG' | 'ALLOCATION_INVERSION' | 'SAMPLE_TOO_SMALL' | 'EXECUTION_BEFORE_DEADLINE' | 'CONTRACT_OUTFLOW_UNKNOWN'`
  - `interface Issue { targetType: 'campaign' | 'influencer' | 'case'; targetId: string; code: IssueCode; severity: 'warn' | 'issue' | 'hold'; evidence: string; label: Label }`
  - `evaluateIssues(input: { campaigns: CampaignPerf[]; influencers: InfluencerPerf[]; cases: Case[]; channelBenchmark: Record<string, number> }): Issue[]`
  - 규칙: LOSS(realRoas<0, issue). 반품률 − 판매채널 벤치마크(%p) > 0 → WARN, > 3 → ISSUE(둘 중 하나만). discountRate > 전체 캠페인 평균(가중: 총할인/(총GMV+총할인)) → DISCOUNT_ABOVE_AVG(warn). 요청 비중 상위 3 ∩ realRoas 하위 3 → ALLOCATION_INVERSION(issue, influencer). orders < 100 → SAMPLE_TOO_SMALL(hold, 이 캠페인의 다른 이슈는 내지 않음). case.executesBeforeDeadline → EXECUTION_BEFORE_DEADLINE(warn). contract && cashOutflowDate === null → CONTRACT_OUTFLOW_UNKNOWN(hold). LOSS·벤치마크 이슈 라벨은 각각 `confirmed`(손익분기)·`benchmark`, 나머지 C층 기준은 `assumption`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const issues = evaluateIssues({ campaigns, influencers, cases, channelBenchmark });
const ids = (code: IssueCode) => issues.filter(i => i.code === code).map(i => i.targetId).sort();
test('loss campaigns', () => { expect(ids('LOSS')).toEqual(['CMP-0001','CMP-0002','CMP-0003','CMP-0012','CMP-0013','CMP-0014']); });
test('allocation inversion', () => { expect(ids('ALLOCATION_INVERSION')).toEqual(['INF-001','INF-005']); });
test('return rate vs channel benchmark', () => {
  expect(ids('RETURN_RATE_ISSUE')).toEqual(expect.arrayContaining(['CMP-0013','CMP-0014'])); // 마켓 9.0% 대비 +3.4, +3.9%p
  expect(ids('RETURN_RATE_WARN')).toContain('CMP-0012');  // 10.4%
  expect([...ids('RETURN_RATE_WARN'), ...ids('RETURN_RATE_ISSUE')]).not.toContain('CMP-0023'); // 자사몰 1.9%
});
test('no sample-size holds in source data, but synthetic small campaign is held', () => {
  expect(ids('SAMPLE_TOO_SMALL')).toEqual([]);
  const small = { ...campaigns[0], campaignId: 'CMP-TEST', orders: 99, realRoas: -1 };
  const r = evaluateIssues({ campaigns: [small], influencers: [], cases: [], channelBenchmark });
  expect(r.map(i => i.code)).toEqual(['SAMPLE_TOO_SMALL']);
});
test('case-level issues', () => {
  expect(ids('EXECUTION_BEFORE_DEADLINE')).toHaveLength(12);
  expect(ids('CONTRACT_OUTFLOW_UNKNOWN')).toEqual(['CONTRACT-INF-001']);
});
test('labels', () => {
  expect(issues.find(i => i.code === 'ALLOCATION_INVERSION')!.label).toBe('assumption');
  expect(issues.find(i => i.code === 'LOSS')!.label).toBe('confirmed');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/issues.test.ts` — Expected: FAIL

- [ ] **Step 3: 구현** — `channelBenchmark`는 `ext_channel_benchmark.return_rate_pct`를 `channel_type` → 비율(%)로. `evidence`는 수치를 포함한 한국어 한 줄(예: `반품률 12.9% (마켓플레이스 기준 9.0%, +3.9%p)`).

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/issues.ts tests/engine/issues.test.ts
git commit -m "feat(engine): evaluate three-layer standards into labeled issues"
```

---

### Task 7: 접수표 조립, CSV 출력, CLI

**Files:**
- Create: `src/engine/intake.ts`, `scripts/intake.ts`, `outputs/intake_baseline.csv`, `outputs/intake_lc45.csv`
- Test: `tests/engine/intake.test.ts`

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces:
  - `interface IntakeRow { 제안ID: string; 종류: '기안' | '전속계약'; 인플루언서: string; 캠페인: string; 요청액: number; 금액규모: '표본' | '풀스케일'; 확정기한: IsoDate; 집행예정일: IsoDate | ''; 실효결정기한: IsoDate; 남은일수: number; 알림단계: string; 기안예상GMV: number | ''; 기안예상명목ROAS: number | ''; 과거명목ROAS: number | ''; 과거실질ROAS: number | ''; 반품률: number | ''; 채널기준반품률: number | ''; 명목순위: number | ''; 실질순위: number | ''; 요청비중: number | ''; 기존집행비중: number | ''; 하회구간: string; 하회구간해당: '예' | '아니오' | '미확인'; 승인경로: string; 판정근거: string; 필요정보: string; 이슈: string; 가정세트: string }`
  - `buildIntake(room: DataRoom, a: AssumptionSet, today?: IsoDate): IntakeRow[]` — 행 순서: 실효결정기한 오름차순, 같으면 제안ID
  - `toCsv(rows: IntakeRow[]): string` — `﻿` + 쉼표 구분 + 필요 시 큰따옴표 이스케이프 + CRLF. 헤더는 `IntakeRow`의 키 순서 그대로.
  - CLI: `npm run intake -- --scenario <ScenarioId> --today <IsoDate> --out <path>` (기본: baseline, 2026-07-01, `outputs/intake_<scenario>.csv`). 승인경로 표시명: CEO_BOARD=`CEO/이사회 상신`, MASIL_CEO_GROUP_REPORT=`Masil 대표 승인 + 그룹 보고`, MASIL_CEO=`Masil 대표 승인`, MARKETING=`마케팅 전결`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const rows = buildIntake(room, DEFAULT_ASSUMPTIONS);
test('26 rows sorted by effective deadline', () => {
  expect(rows).toHaveLength(26);
  expect(rows[0].실효결정기한).toBe('2026-07-17');
});
test('key rows', () => {
  const p1 = rows.find(r => r.제안ID === 'PLAN-001')!;
  expect(p1).toMatchObject({ 승인경로: 'CEO/이사회 상신', 하회구간해당: '예', 남은일수: 16, 금액규모: '표본' });
  expect(p1.이슈).toContain('LOSS');
  const c = rows.find(r => r.제안ID === 'CONTRACT-INF-001')!;
  expect(c).toMatchObject({ 종류: '전속계약', 금액규모: '풀스케일', 하회구간해당: '미확인', 필요정보: 'cash_outflow_date' });
});
test('CSV opens in Excel with Korean headers', () => {
  const csv = toCsv(rows);
  expect(csv.startsWith('﻿제안ID,종류,')).toBe(true);
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(27);
});
test('lc45 scenario changes routes, not loss issues', () => {
  const r45 = buildIntake(room, SCENARIOS.lc45);
  expect(r45.filter(r => r.종류 === '기안' && r.승인경로 === 'CEO/이사회 상신')).toHaveLength(0);
  expect(r45.filter(r => r.이슈.includes('LOSS'))).toHaveLength(rows.filter(r => r.이슈.includes('LOSS')).length);
});
test('full pipeline leaves raw files untouched', () => {
  const before = hashDataFiles(); buildIntake(room, DEFAULT_ASSUMPTIONS); expect(hashDataFiles()).toEqual(before);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/engine/intake.test.ts` — Expected: FAIL

- [ ] **Step 3: `buildIntake`, `toCsv`, CLI 구현** — 행의 성과 열은 기안이면 해당 캠페인·인플루언서 값, 전속계약이면 인플루언서 값만(캠페인 열 빈칸). 비율 열은 소수 셋째 자리 반올림 숫자. `이슈`는 해당 캠페인·인플루언서·건 이슈 코드를 `;`로 연결.

- [ ] **Step 4: 통과 확인** — Run: `npm test` — Expected: PASS

- [ ] **Step 5: 출력 생성과 육안 확인**

Run: `npm run intake -- --scenario baseline` 그리고 `npm run intake -- --scenario lc45`
Expected: `outputs/intake_baseline.csv`(27줄), `outputs/intake_lc45.csv` 생성. 첫 데이터 행의 실효결정기한 `2026-07-17`. 원본 폴더 `git status`에 변경 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/intake.ts scripts/intake.ts tests/engine/intake.test.ts outputs/intake_baseline.csv outputs/intake_lc45.csv
git commit -m "feat(engine): assemble intake sheet and export Excel-ready CSV"
```

---

## 계획 1 완료 기준

- `npm test` 전부 통과(정답 기준 테스트 포함), 원본 폴더 변경 없음
- `outputs/intake_baseline.csv`를 엑셀로 열면 한글 헤더와 26건이 보이고, 마케팅·재무가 승인 경로·실효 기한·이슈를 바로 확인할 수 있음 (명세 12장 2단계 "업무에서 사용 가능")

## 계획 2 개요 (계획 1 완료 후 별도 문서로 작성)

계획 1의 엔진을 그대로 가져다 쓴다. 이 개요는 범위를 보여 주기 위한 것이며 작업 지시가 아니다.

1. Next.js(App Router) 골격과 저장소 계층: 운영은 PostgreSQL(`DATABASE_URL`, `axhub.yaml`의 `database.engine: postgres`), 로컬·테스트는 같은 SQL을 쓰는 내장 Postgres(PGlite). 엔티티: 업무 시계, 제안 건 상태, 확인 요청, 이력, 가정 세트.
2. 상태 흐름과 기한 가드(필수 확장): 접수→…→승인/거절/보류, 보류 시 담당·기한 필수, 업무 시계 진행 시 D-14·7·3 알림, D-3 에스컬레이션, 기한 경과 처리, 연결 그룹 경고.
3. 화면 4개: 오늘 결정할 것, 건 상세(결정 버튼), 확인 요청함, 가정·기준값.
4. AI 어댑터: 상신 근거 요약, 확인 요청서 초안, 모의 회신 구조화. 숫자 대조 장치. 키가 없으면 규칙 기반 템플릿 + "AI 미사용" 표시. 키 등록은 사용자가 직접 한다(`axhub env set ANTHROPIC_API_KEY --secret --from-stdin`).
5. 시연 3건 재현 스크립트와 초기화.
6. 배포 전환: 현재 정적 사이트 설정(`axhub.yaml`의 `deploy_method: static`)을 서버 앱으로 바꾸고, `PORT`·`0.0.0.0`·헬스체크 경로를 맞춘 뒤 배포 확인.
7. A04 제출 문서 초안과 재현 절차.
