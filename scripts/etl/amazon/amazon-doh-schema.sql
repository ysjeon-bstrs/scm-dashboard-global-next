-- Amazon sales + DOH Supabase schema for code-owned ETL
-- Apply after scripts/etl/amazon/amazon-inventory-schema.sql.
-- Legacy public.amz_doh remains a parity baseline only; dashboard-owned reads should use mart_amazon_doh_snapshot.

create table if not exists public.mart_amazon_sales_daily (
  raw_key text primary key,
  order_date_pt date not null,
  center text not null,
  marketplaceid text not null,
  sales_channel text not null default '',
  asin text not null,
  resource_code text not null,
  resource_name text,
  qty_total integer not null default 0,
  qty_shipped integer not null default 0,
  qty_unshipped integer not null default 0,
  source_order_count integer not null default 0,
  source_detail_count integer not null default 0,
  source_min_purchase_at timestamptz,
  source_max_purchase_at timestamptz,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_date_pt, center, marketplaceid, sales_channel, asin, resource_code)
);

create index if not exists mart_amazon_sales_daily_center_date_idx
  on public.mart_amazon_sales_daily (center, order_date_pt desc);

create index if not exists mart_amazon_sales_daily_sku_date_idx
  on public.mart_amazon_sales_daily (resource_code, center, order_date_pt desc);

create index if not exists mart_amazon_sales_daily_asin_idx
  on public.mart_amazon_sales_daily (asin, order_date_pt desc);

create table if not exists public.mart_amazon_doh_snapshot (
  raw_key text primary key,
  snapshot_date date not null,
  sales_window_end_date date not null,
  center text not null,
  resource_code text not null,
  resource_name text,
  stock_sellable integer not null default 0,
  stock_available integer not null default 0,
  pending_fc integer not null default 0,
  stock_incoming integer not null default 0,
  stock_expected integer not null default 0,
  stock_processing integer not null default 0,
  stock_readytoship integer not null default 0,
  customer_order integer not null default 0,
  qty_1d integer not null default 0,
  qty_7d integer not null default 0,
  qty_30d integer not null default 0,
  qty_90d integer not null default 0,
  vel_7d numeric(12, 4) not null default 0,
  vel_30d numeric(12, 4) not null default 0,
  vel_90d numeric(12, 4) not null default 0,
  doh_7d numeric(12, 2) not null default 999,
  doh_30d numeric(12, 2) not null default 999,
  doh_90d numeric(12, 2) not null default 999,
  target_days integer not null default 45,
  warn_days integer not null default 40,
  danger_days integer not null default 35,
  fee_risk_days integer not null default 28,
  required_qty_gross integer not null default 0,
  required_qty_net integer not null default 0,
  recommended_ship_qty integer not null default 0,
  gap_45d integer not null default 0,
  status text not null,
  fee_risk boolean not null default false,
  urgency_rank integer not null default 999,
  action_label text not null,
  action_reason text not null,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, center, resource_code)
);

create index if not exists mart_amazon_doh_snapshot_center_status_idx
  on public.mart_amazon_doh_snapshot (snapshot_date, center, urgency_rank, required_qty_net desc);

create index if not exists mart_amazon_doh_snapshot_sku_idx
  on public.mart_amazon_doh_snapshot (resource_code, center, snapshot_date desc);

create index if not exists mart_amazon_doh_snapshot_fee_risk_idx
  on public.mart_amazon_doh_snapshot (snapshot_date, center, fee_risk)
  where fee_risk = true;
