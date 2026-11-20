import type { IsoDate } from './types.js';

/** confirmed: 원본 확정 / benchmark: 외부 벤치마크 / assumption: 자료에 없어 정한 값 */
export type Label = 'confirmed' | 'benchmark' | 'assumption';

export type ScenarioId = 'baseline' | 'arOverdueExcluded' | 'apOverdueExcluded' | 'bothOverdueExcluded' | 'lc45';

type LabeledField = 'unitsPerOrder' | 'channelFeeBasis' | 'recoverCostOnRefund' | 'calcMode' | 'overdueAr' | 'overdueAp' | 'lc0001TermsDays' | 'returnAttribution';

export interface AssumptionSet {
  id: ScenarioId;
  version: string;
  /** 주문 1건당 판매 수량 (원본 주문 행에 수량 없음) */
  unitsPerOrder: number;
  /** 채널수수료를 GMV 기준으로 볼지 순매출 기준으로 볼지 */
  channelFeeBasis: 'gmv' | 'net';
  /** 반품 주문의 제품원가·수수료를 회수한다고 볼지 */
  recoverCostOnRefund: boolean;
  /** a05: 이중 차감 없음(적용). literal-calc-def: calculation_definitions 1.4 글자 그대로(회귀 검증용) */
  calcMode: 'a05' | 'literal-calc-def';
  /** 기준일 전 연체 매출채권: 기준일에 회수 / 제외 */
  overdueAr: 'asof' | 'exclude';
  /** 기준일 전 연체 운영 매입채무: 기준일에 지급 / 제외 */
  overdueAp: 'asof' | 'exclude';
  /** LC-0001 결제조건 (통보서 90일, 재무 공식 전망 가정 45일) */
  lc0001TermsDays: 90 | 45;
  /**
   * 반품 원인 분리 보기. 'all'(기본) = 모든 반품을 인플루언서 성과에 반영.
   * 'demandOnly' = 오배송·불량 반품의 환불액과 반품 물류비를 인플루언서 성과에서 제외(평가용 보기, 회사 손익은 그대로).
   */
  returnAttribution: 'all' | 'demandOnly';
  asOf: IsoDate;
  labels: Record<LabeledField, Label>;
}

const BASE: AssumptionSet = {
  id: 'baseline',
  version: '2026-11-11.1',
  unitsPerOrder: 1,
  channelFeeBasis: 'gmv',
  recoverCostOnRefund: false,
  calcMode: 'a05',
  overdueAr: 'asof',
  overdueAp: 'asof',
  lc0001TermsDays: 90,
  returnAttribution: 'all',
  asOf: '2026-07-01',
  labels: {
    unitsPerOrder: 'assumption',
    channelFeeBasis: 'assumption',
    recoverCostOnRefund: 'assumption',
    calcMode: 'confirmed',
    overdueAr: 'assumption',
    overdueAp: 'assumption',
    lc0001TermsDays: 'confirmed',
    // [가정: 오배송·불량은 인플루언서 책임이 아니라는 해석]
    returnAttribution: 'assumption',
  },
};

export const SCENARIOS: Record<ScenarioId, AssumptionSet> = {
  baseline: BASE,
  arOverdueExcluded: { ...BASE, id: 'arOverdueExcluded', overdueAr: 'exclude' },
  apOverdueExcluded: { ...BASE, id: 'apOverdueExcluded', overdueAp: 'exclude' },
  bothOverdueExcluded: { ...BASE, id: 'bothOverdueExcluded', overdueAr: 'exclude', overdueAp: 'exclude' },
  lc45: { ...BASE, id: 'lc45', lc0001TermsDays: 45, labels: { ...BASE.labels, lc0001TermsDays: 'assumption' } },
};

export const DEFAULT_ASSUMPTIONS = SCENARIOS.baseline;

/** 반품 원인 분리 보기(인플루언서 평가용). 가정 세트가 아니라 점검 결과에 별도 숫자로만 쓰고 판정·승인 경로에는 쓰지 않는다. */
export const DEMAND_ONLY_VIEW: AssumptionSet = { ...BASE, returnAttribution: 'demandOnly' };

export const THRESHOLDS = {
  perItemKrw: 10_000_000,
  planTotalKrw: 100_000_000,
  contractAnnualKrw: 1_000_000_000,
  covenantMinKrw: 3_000_000_000,
  returnIssuePp: 3,
  returnWarnMinPp: 0.5,
  minOrders: 100,
  /** 입력 오류 방지용 상한 [가정]: 전속계약 고정 피 연 1,000억 원(Masil 연매출 약 1,800억 원의 절반 이상), 시계는 업무 기준일 + 365일 */
  maxAnnualFixedFeeKrw: 100_000_000_000,
  maxClockJumpDays: 365,
  alertDays: [14, 7, 3] as const,
  boardDate: '2026-07-06' as IsoDate,
  labels: {
    perItemKrw: 'confirmed', planTotalKrw: 'confirmed', contractAnnualKrw: 'confirmed',
    covenantMinKrw: 'confirmed', returnIssuePp: 'assumption', returnWarnMinPp: 'assumption', minOrders: 'assumption',
    alertDays: 'assumption', boardDate: 'confirmed', maxAnnualFixedFeeKrw: 'assumption', maxClockJumpDays: 'assumption',
  } satisfies Record<string, Label>,
} as const;
