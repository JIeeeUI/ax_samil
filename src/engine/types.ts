/** 'YYYY-MM-DD' */
export type IsoDate = string;

// ---- 마스터(참조) ----
export interface CampaignRow {
  campaign_id: string; campaign_name: string; influencer_id: string; country: string;
  sns_channel: string; sns_format: string; sales_channel: string; product_line: string;
  start_date: IsoDate; end_date: IsoDate; attribution_window_days: number;
}
export interface InfluencerRow {
  influencer_id: string; influencer_name: string; tier: string; primary_country: string;
  platform: string; fee_type: string;
}
export interface ChannelRow {
  channel_id: string; channel_name: string; channel_type: string; partner_code: string | null;
  country: string; payment_terms_days: number; effective_date: IsoDate;
}
export interface SkuRow {
  sku_id: string; sku_name: string; category: string; product_id: string; source_company: string;
  safety_stock_weeks_min: number; safety_stock_weeks_max: number; moq: number; lead_time_weeks: number;
}

// ---- 표본 계열 (커머스 트랜잭션, 대표 표본) ----
export interface OrderRow {
  order_id: string; order_date: IsoDate; customer_ref: string; channel_id: string; country: string;
  sku_id: string; campaign_id: string; gmv_krw: number; coupon_discount_krw: number;
}
export interface ReturnRow {
  return_id: string; order_id: string; refund_completed_date: IsoDate; original_order_date: IsoDate;
  refund_amount_krw: number; reason: string;
}
export interface CouponRow {
  coupon_use_id: string; order_id: string; coupon_id: string; discount_krw: number; stacked_flag: boolean;
}
export interface AdSpendRow {
  spend_id: string; campaign_id: string; spend_date: IsoDate; media: string; platform: string;
  sns_format: string; ad_cost_krw: number; influencer_fee_krw: number | null;
}
export interface CostMasterRow {
  sku_id: string; channel_id: string; product_cost_krw: number; channel_fee_pct: number;
  shipping_cost_krw: number; return_logistics_cost_krw: number;
}
export interface BudgetPlanRow {
  plan_id: string; campaign_id: string; requested_budget_krw: number; expected_gmv_krw: number;
  settlement_date: IsoDate; contract_deadline: IsoDate;
}

// ---- 풀스케일 계열 (자금) ----
export interface CashDailyRow {
  date: IsoDate; opening_balance: number; inflow_krw: number; outflow_krw: number;
  closing_balance: number; covenant_min_krw: number; breach_flag: boolean;
}
export interface ArAgingRow {
  ar_id: string; channel_id: string; invoice_date: IsoDate; due_date: IsoDate;
  amount_krw: number; outstanding_krw: number; aging_days: number;
}
export interface ApAgingRow {
  ap_id: string; supplier_id: string; po_id: string | null; invoice_date: IsoDate;
  payment_due_date: IsoDate; amount_krw: number; aging_days: number;
}
export interface PurchaseOrderRow {
  po_id: string; sku_id: string; supplier_id: string; order_date: IsoDate; order_qty: number;
  moq: number; lead_time_weeks: number; amount_krw: number; payment_due_date: IsoDate;
}
export interface CashForecastRow {
  forecast_date: IsoDate; week: IsoDate; projected_inflow_krw: number;
  projected_outflow_krw: number; projected_closing_krw: number;
}

// ---- 외부 벤치마크 ----
export interface ChannelBenchmarkRow {
  channel_type: string; return_rate_pct: number; repurchase_rate_pct: number;
  contribution_margin_pct: number; source: string;
}
export interface IndustryBenchmarkRow { metric: string; value: number; note: string }

export interface Masters {
  campaigns: CampaignRow[]; influencers: InfluencerRow[]; channels: ChannelRow[]; skus: SkuRow[];
}
/** 표본 계열. 절대금액을 풀스케일 계열과 섞지 않는다. */
export interface SampleTables {
  orders: OrderRow[]; returns: ReturnRow[]; coupons: CouponRow[]; adSpend: AdSpendRow[];
  costMaster: CostMasterRow[]; budgetPlan: BudgetPlanRow[];
}
/** 풀스케일 계열(회사 실제 규모). 필드명이 SampleTables와 겹치지 않아 서로 대입할 수 없다. */
export interface FullTables {
  cashDaily: CashDailyRow[]; arAging: ArAgingRow[]; apAging: ApAgingRow[];
  purchaseOrders: PurchaseOrderRow[]; cashForecast: CashForecastRow[];
}
export interface DataRoom {
  masters: Masters;
  sample: SampleTables;
  full: FullTables;
  benchmarks: { channel: ChannelBenchmarkRow[]; industry: IndustryBenchmarkRow[] };
}
