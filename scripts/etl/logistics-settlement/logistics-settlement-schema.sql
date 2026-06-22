-- Logistics settlement Supabase schema
-- Apply in Supabase SQL editor before running sync-ocean-settlement.ts --apply.

create table if not exists public.stg_settlement_ocean_lines (
  raw_key text primary key,
  invoice_date date,
  bl_no text not null,
  country text not null default '',
  charge_type text not null default '',
  currency text not null default '',
  amount_orig numeric not null default 0,
  exrate numeric not null default 0,
  amount_krw numeric not null default 0,
  tax_krw numeric not null default 0,
  pol text not null default '',
  pod text not null default '',
  vessel text not null default '',
  weight_kg numeric not null default 0,
  cbm numeric not null default 0,
  container_type text not null default '',
  packages numeric not null default 0,
  file_name text not null default '',
  file_id text not null default '',
  source_updated_at timestamptz,
  etl_run_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stg_ocean_bl on public.stg_settlement_ocean_lines (bl_no);
create index if not exists idx_stg_ocean_invoice_date on public.stg_settlement_ocean_lines (invoice_date);
create index if not exists idx_stg_ocean_container on public.stg_settlement_ocean_lines (container_type);

-- Optional cache tables kept for future overrides only.
-- Ocean MVP reads MASTER_품목 and MASTER_단가 directly from boosters_scm:
--   scm_global_move_master_item
--   scm_global_move_master_unit_price
create table if not exists public.config_logistics_sku_master (
  resource_code text primary key,
  resource_name text not null default '',
  sku_weight_g numeric not null default 0,
  box_count numeric not null default 0,
  carton_weight_kg numeric not null default 0,
  carton_width_cm numeric not null default 0,
  carton_length_cm numeric not null default 0,
  carton_height_cm numeric not null default 0,
  source text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.config_logistics_unit_price (
  raw_key text primary key,
  from_country text not null default '',
  to_country text not null default '',
  resource_code text not null,
  resource_name text not null default '',
  proposal_unit_price_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_config_unit_price_sku on public.config_logistics_unit_price (resource_code);
create index if not exists idx_config_unit_price_route_sku on public.config_logistics_unit_price (from_country, to_country, resource_code);

create table if not exists public.mart_logistics_doc_analysis (
  raw_key text primary key,
  source_line_id bigint not null,
  invoice_no text not null default '',
  bl_no text not null default '',
  carrier text not null default '',
  carrier_mode text not null default '',
  ship_date date,
  settlement_month text not null default '',
  from_warehouse text not null default '',
  to_warehouse text not null default '',
  resource_code text not null default '',
  resource_name text not null default '',
  qty_ea numeric not null default 0,
  qty_ctn numeric not null default 0,
  weight_ratio_pct numeric not null default 0,
  value_ratio_pct numeric not null default 0,
  invoice_total_logistics_krw numeric not null default 0,
  invoice_total_freight_krw numeric not null default 0,
  invoice_total_duty_krw numeric not null default 0,
  invoice_total_other_krw numeric not null default 0,
  sku_logistics_alloc_krw numeric not null default 0,
  sku_logistics_unit_krw numeric not null default 0,
  sku_freight_unit_krw numeric not null default 0,
  sku_duty_unit_krw numeric not null default 0,
  sku_other_unit_krw numeric not null default 0,
  container_type text not null default '',
  allocation_rule_version text not null default '',
  etl_run_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mart_logistics_doc_mode_month on public.mart_logistics_doc_analysis (carrier_mode, settlement_month);
create index if not exists idx_mart_logistics_doc_bl on public.mart_logistics_doc_analysis (bl_no);
create index if not exists idx_mart_logistics_doc_sku on public.mart_logistics_doc_analysis (resource_code);

create table if not exists public.mart_logistics_monthly_sku_cost (
  raw_key text primary key,
  month text not null,
  carrier_mode text not null,
  resource_code text not null,
  resource_name text not null default '',
  qty_ea numeric not null default 0,
  qty_ctn numeric not null default 0,
  bl_count integer not null default 0,
  invoice_count integer not null default 0,
  monthly_total_logistics_krw numeric not null default 0,
  monthly_total_freight_krw numeric not null default 0,
  monthly_total_duty_krw numeric not null default 0,
  monthly_total_other_krw numeric not null default 0,
  sku_logistics_alloc_krw numeric not null default 0,
  sku_logistics_unit_krw numeric not null default 0,
  sku_freight_unit_krw numeric not null default 0,
  sku_duty_unit_krw numeric not null default 0,
  sku_other_unit_krw numeric not null default 0,
  allocation_rule_version text not null default '',
  etl_run_id text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_mart_logistics_monthly_mode_month on public.mart_logistics_monthly_sku_cost (carrier_mode, month);
create index if not exists idx_mart_logistics_monthly_sku on public.mart_logistics_monthly_sku_cost (resource_code);

create table if not exists public.mart_logistics_cost_calibration (
  raw_key text primary key,
  calibration_month text not null,
  carrier_mode text not null,
  cost_component text not null,
  resource_code text not null,
  current_baseline_usd numeric,
  actual_month_usd numeric,
  actual_rolling_3mo_max_usd numeric,
  deviation_pct numeric,
  decision_status text not null default 'KEEP_BASELINE',
  recommended_new_baseline_usd numeric,
  effective_from_month text,
  decision_reason text not null default '',
  etl_run_id text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_mart_logistics_calibration_month on public.mart_logistics_cost_calibration (calibration_month, carrier_mode);

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

create table if not exists public.logistics_settlement_source_files (
  raw_key text primary key,
  mode text not null,
  provider text not null default 'google_drive',
  file_id text not null,
  file_name text not null,
  normalized_name text not null default '',
  mime_type text not null default '',
  web_view_link text not null default '',
  parent_folder_id text not null default '',
  modified_time timestamptz,
  size_bytes bigint,
  detected_invoice_no text not null default '',
  detected_bl_no text not null default '',
  detected_period text not null default '',
  scan_status text not null default 'FOUND',
  import_status text not null default 'NOT_IMPORTED',
  last_scan_run_id text not null default '',
  last_import_run_id text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  source_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, file_id)
);

create index if not exists idx_logistics_source_files_mode_status
  on public.logistics_settlement_source_files (mode, scan_status, import_status);

create index if not exists idx_logistics_source_files_bl
  on public.logistics_settlement_source_files (detected_bl_no);

create table if not exists public.logistics_settlement_job_events (
  id bigserial primary key,
  etl_run_id text not null,
  level text not null default 'INFO',
  step text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_logistics_job_events_run
  on public.logistics_settlement_job_events (etl_run_id, id);
