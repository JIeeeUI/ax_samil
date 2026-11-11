import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePipeCsv } from './csv.js';
import type { DataRoom } from './types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 원본 데이터룸 경로. 읽기 전용으로만 사용한다. */
export function defaultDataDir(): string {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(REPO_ROOT, '01_참가자_배포용', '04_원본데이터');
}

interface TableSpec { file: string; numeric?: string[]; boolean?: string[] }

const T = {
  campaigns: { file: '02_masil/master/m_campaign_ms.csv', numeric: ['attribution_window_days'] },
  influencers: { file: '02_masil/master/m_influencer_ms.csv' },
  channels: { file: '02_masil/master/m_channel_ms.csv', numeric: ['payment_terms_days'] },
  skus: { file: '02_masil/master/m_sku_ms.csv', numeric: ['safety_stock_weeks_min', 'safety_stock_weeks_max', 'moq', 'lead_time_weeks'] },
  orders: { file: '02_masil/marketing/mkt_orders_ms.csv', numeric: ['gmv_krw', 'coupon_discount_krw'] },
  returns: { file: '02_masil/marketing/mkt_returns_ms.csv', numeric: ['refund_amount_krw'] },
  coupons: { file: '02_masil/marketing/mkt_coupons_ms.csv', numeric: ['discount_krw'], boolean: ['stacked_flag'] },
  adSpend: { file: '02_masil/marketing/mkt_ad_spend_ms.csv', numeric: ['ad_cost_krw', 'influencer_fee_krw'] },
  costMaster: { file: '02_masil/marketing/mkt_cost_master_ms.csv', numeric: ['product_cost_krw', 'channel_fee_pct', 'shipping_cost_krw', 'return_logistics_cost_krw'] },
  budgetPlan: { file: '02_masil/marketing/mkt_budget_plan_ms.csv', numeric: ['requested_budget_krw', 'expected_gmv_krw'] },
  cashDaily: { file: '02_masil/financials/fin_cash_daily_ms.csv', numeric: ['opening_balance', 'inflow_krw', 'outflow_krw', 'closing_balance', 'covenant_min_krw'], boolean: ['breach_flag'] },
  arAging: { file: '02_masil/financials/fin_ar_aging_ms.csv', numeric: ['amount_krw', 'outstanding_krw', 'aging_days'] },
  apAging: { file: '02_masil/financials/fin_ap_aging_ms.csv', numeric: ['amount_krw', 'aging_days'] },
  purchaseOrders: { file: '02_masil/inventory/sc_purchase_orders_ms.csv', numeric: ['order_qty', 'moq', 'lead_time_weeks', 'amount_krw'] },
  cashForecast: { file: '02_masil/financials/fin_cash_forecast_ms.csv', numeric: ['projected_inflow_krw', 'projected_outflow_krw', 'projected_closing_krw'] },
  channelBenchmark: { file: '05_external/benchmark/ext_channel_benchmark.csv', numeric: ['return_rate_pct', 'repurchase_rate_pct', 'contribution_margin_pct'] },
  industryBenchmark: { file: '05_external/benchmark/ext_industry_benchmark.csv', numeric: ['value'] },
} satisfies Record<string, TableSpec>;

/** 해시로 불변을 검증하는 원본 파일(적재 대상 CSV + 판단 근거 문서). */
const HASHED_DOCS = [
  '00_common/approval_authority_policy.md',
  '00_common/calculation_definitions.md',
  '00_common/data_dictionary.md',
  '02_masil/financials/covenant_terms_ms.md',
  '02_masil/financials/lc0001_payment_term_notice.md',
  '02_masil/marketing/inf001_exclusive_contract_notice.md',
];

function readTable(dataDir: string, spec: TableSpec): unknown[] {
  const rows = parsePipeCsv(readFileSync(join(dataDir, spec.file), 'utf8'));
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const c of spec.numeric ?? []) {
      const v = r[c];
      if (v === null || v === undefined) out[c] = null;
      else {
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`${spec.file}: column ${c} is not numeric: ${v}`);
        out[c] = n;
      }
    }
    for (const c of spec.boolean ?? []) out[c] = r[c] === 'True';
    return out;
  });
}

export function loadDataRoom(dataDir: string = defaultDataDir()): DataRoom {
  const t = <K extends keyof typeof T>(k: K) => readTable(dataDir, T[k]) as never;
  return {
    masters: { campaigns: t('campaigns'), influencers: t('influencers'), channels: t('channels'), skus: t('skus') },
    sample: {
      orders: t('orders'), returns: t('returns'), coupons: t('coupons'), adSpend: t('adSpend'),
      costMaster: t('costMaster'), budgetPlan: t('budgetPlan'),
    },
    full: {
      cashDaily: t('cashDaily'), arAging: t('arAging'), apAging: t('apAging'),
      purchaseOrders: t('purchaseOrders'), cashForecast: t('cashForecast'),
    },
    benchmarks: { channel: t('channelBenchmark'), industry: t('industryBenchmark') },
  };
}

/** 원본 파일 상대경로 → SHA-256. 읽기만 한다. */
export function hashDataFiles(dataDir: string = defaultDataDir()): Record<string, string> {
  const files = [...Object.values(T).map((s) => s.file), ...HASHED_DOCS].sort();
  return Object.fromEntries(
    files.map((f) => [f, createHash('sha256').update(readFileSync(join(dataDir, f))).digest('hex')]),
  );
}
