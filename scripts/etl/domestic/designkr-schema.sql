-- 디자인KR domestic stock Supabase schema
-- Apply in Supabase SQL editor before running the ETL apply mode.
-- Company/Nansoft DB remains read-only; these tables are the dashboard-owned raw/mart store.

create table if not exists public.raw_domestic_stock_location_snapshots (
  source_raw_key text primary key,
  snapshot_date date not null,
  warehouse_code text not null default 'DESIGN_KR',
  source_system text not null default 'nansoft',
  product_code text not null,
  product_name text,
  barcode text,
  lot text not null,
  expiration_date date,
  warehouse_lname text not null,
  location text not null,
  stock_quantity integer not null default 0,
  delivery_wait_quantity integer not null default 0,
  available_stock_quantity integer not null default 0,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists raw_domestic_stock_snapshot_sku_idx
  on public.raw_domestic_stock_location_snapshots (snapshot_date, warehouse_code, product_code);

create index if not exists raw_domestic_stock_snapshot_bucket_idx
  on public.raw_domestic_stock_location_snapshots (snapshot_date, warehouse_code, warehouse_lname);

create index if not exists raw_domestic_stock_sku_lot_exp_idx
  on public.raw_domestic_stock_location_snapshots (product_code, lot, expiration_date);

create table if not exists public.config_domestic_stock_bucket_mapping (
  warehouse_code text not null,
  source_warehouse_lname text not null,
  bucket_code text not null,
  bucket_name text,
  include_in_running_stock boolean not null default false,
  active boolean not null default true,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (warehouse_code, source_warehouse_lname)
);

insert into public.config_domestic_stock_bucket_mapping
  (warehouse_code, source_warehouse_lname, bucket_code, bucket_name, include_in_running_stock, note)
values
  ('DESIGN_KR', 'DL_입고', 'design_inbound', '디자인로지스 입고완료', true, '가상창고 분리 전 임시 운영재고'),
  ('DESIGN_KR', '임시(부스터스)', 'temporary_boosters', '임시(부스터스)', false, '운영재고 제외'),
  ('DESIGN_KR', '입고_대기', 'inbound_waiting', '입고 대기', false, '운영재고 제외'),
  ('DESIGN_KR', '글로벌_B2B_KEEPING', 'legacy_b2b_keeping', '기존 B2B keeping', false, '운영재고 제외'),
  ('DESIGN_KR', '분실창고', 'lost', '분실창고', false, '운영재고 제외'),
  ('DESIGN_KR', '불량창고', 'defective', '불량창고', false, '운영재고 제외'),
  ('DESIGN_KR', '폐기창고', 'disposal', '폐기창고', false, '운영재고 제외')
on conflict (warehouse_code, source_warehouse_lname) do update set
  bucket_code = excluded.bucket_code,
  bucket_name = excluded.bucket_name,
  include_in_running_stock = excluded.include_in_running_stock,
  note = excluded.note,
  active = true,
  updated_at = now();

create table if not exists public.mart_domestic_stock_lot_snapshot (
  raw_key text primary key,
  snapshot_date date not null,
  warehouse_code text not null,
  product_code text not null,
  product_name text,
  barcode text,
  lot text not null,
  expiration_date date,
  warehouse_lname text not null,
  location text not null,
  bucket_code text not null,
  bucket_name text,
  include_in_running_stock boolean not null default false,
  stock_quantity integer not null default 0,
  delivery_wait_quantity integer not null default 0,
  available_stock_quantity integer not null default 0,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mart_domestic_stock_lot_sku_idx
  on public.mart_domestic_stock_lot_snapshot (snapshot_date, warehouse_code, product_code);

create index if not exists mart_domestic_stock_lot_exp_idx
  on public.mart_domestic_stock_lot_snapshot (expiration_date);

create index if not exists mart_domestic_stock_lot_bucket_idx
  on public.mart_domestic_stock_lot_snapshot (snapshot_date, warehouse_code, bucket_code);

create table if not exists public.mart_domestic_stock_sku_snapshot (
  raw_key text primary key,
  snapshot_date date not null,
  warehouse_code text not null,
  product_code text not null,
  product_name text,
  stock_running integer not null default 0,
  stock_total integer not null default 0,
  stock_excluded integer not null default 0,
  available_running integer not null default 0,
  delivery_wait_quantity integer not null default 0,
  lot_count integer not null default 0,
  nearest_expiration_date date,
  etl_run_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, warehouse_code, product_code)
);

create index if not exists mart_domestic_stock_sku_running_idx
  on public.mart_domestic_stock_sku_snapshot (snapshot_date, warehouse_code, stock_running desc);

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
