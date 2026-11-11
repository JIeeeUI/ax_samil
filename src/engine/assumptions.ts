import type { IsoDate } from './types.js';

/** confirmed: 원본 확정 / benchmark: 외부 벤치마크 / assumption: 자료에 없어 정한 값 */
export type Label = 'confirmed' | 'benchmark' | 'assumption';

export type ScenarioId = 'baseline' | 'arOverdueExcluded' | 'apOverdueExcluded' | 'bothOverdueExcluded' | 'lc45';

type LabeledField = 'unitsPerOrder' | 'channelFeeBasis' | 'recoverCostOnRefund' | 'calcMode' | 'overdueAr' | 'overdueAp' | 'lc0001TermsDays';

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
  asOf: '2026-07-01',
  labels: {
    unitsPerOrder: 'assumption',
    channelFeeBasis: 'assumption',
    recoverCostOnRefund: 'assumption',
    calcMode: 'confirmed',
    overdueAr: 'assumption',
    overdueAp: 'assumption',
    lc0001TermsDays: 'confirmed',
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

export const THRESHOLDS = {
  perItemKrw: 10_000_000,
  planTotalKrw: 100_000_000,
  contractAnnualKrw: 1_000_000_000,
  covenantMinKrw: 3_000_000_000,
  returnIssuePp: 3,
  minOrders: 100,
  alertDays: [14, 7, 3] as const,
  boardDate: '2026-07-06' as IsoDate,
  labels: {
    perItemKrw: 'confirmed', planTotalKrw: 'confirmed', contractAnnualKrw: 'confirmed',
    covenantMinKrw: 'confirmed', returnIssuePp: 'assumption', minOrders: 'assumption',
    alertDays: 'assumption', boardDate: 'confirmed',
  } satisfies Record<string, Label>,
} as const;
