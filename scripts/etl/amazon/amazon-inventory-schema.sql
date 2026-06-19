-- Amazon inventory Supabase schema for code-owned ETL
-- Apply in Supabase SQL editor before running scripts/etl/amazon/sync-amazon-inventory.ts --apply.
-- Legacy public.amz_stock remains a parity baseline only; dashboard-owned reads should use mart_amazon_inventory_snapshot.

create table if not exists public.raw_amazon_inventory_snapshots (
  raw_key text primary key,
  snapshot_date date not null,
  source_system text not null default 'boosters_crew.amazon_fba_inventorys',
  marketplaceid text not null,
  center text not null,
  asin text,
  asin_list text,
  resource_code text not null,
  fulfillable_quantity integer not null default 0,
  pending_transshipment_quantity integer not null default 0,
  inbound_shipped_quantity integer not null default 0,
  inbound_receiving_quantity integer not null default 0,
  inbound_working_quantity integer not null default 0,
  pending_customer_order_quantity integer not null default 0,
  fc_processing_quantity integer not null default 0,
  source_row_count integer not null default 0,
  source_max_id bigint,
  latest_updated_at timestamptz,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, center, resource_code)
);

create index if not exists raw_amazon_inventory_snapshot_center_idx
  on public.raw_amazon_inventory_snapshots (snapshot_date, center);

create index if not exists raw_amazon_inventory_snapshot_sku_idx
  on public.raw_amazon_inventory_snapshots (resource_code, center, snapshot_date desc);

create table if not exists public.mart_amazon_inventory_snapshot (
  raw_key text primary key,
  snapshot_date date not null,
  center text not null,
  resource_code text not null,
  stock_sellable integer not null default 0,
  stock_available integer not null default 0,
  pending_fc integer not null default 0,
  stock_expected integer not null default 0,
  stock_processing integer not null default 0,
  stock_readytoship integer not null default 0,
  customer_order integer not null default 0,
  fc_processing integer not null default 0,
  stock_incoming integer generated always as (stock_expected + stock_processing + stock_readytoship) stored,
  source_row_count integer not null default 0,
  source_max_id bigint,
  latest_updated_at timestamptz,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, center, resource_code)
);

create index if not exists mart_amazon_inventory_snapshot_center_idx
  on public.mart_amazon_inventory_snapshot (snapshot_date, center);

create index if not exists mart_amazon_inventory_snapshot_sku_idx
  on public.mart_amazon_inventory_snapshot (resource_code, center, snapshot_date desc);

create index if not exists mart_amazon_inventory_snapshot_sellable_idx
  on public.mart_amazon_inventory_snapshot (snapshot_date, center, stock_sellable desc);

-- etl_run_logs is shared with DesignKR ETL. Keep this here so the schema file is self-contained.
create table if not exists public.etl_run_logs (
  etl_run_id text primary key,
  pipeline text not null,
  status text not null,
  snapshot_date date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_rows integer,
  raw_rows integer,
  mart_lot_rows integer,
  mart_sku_rows integer,
  summary jsonb,
  error_message text
);
