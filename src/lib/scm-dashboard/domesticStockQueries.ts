import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface DomesticStockSkuRow {
  raw_key: string;
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
  product_name: string | null;
  stock_running: number;
  stock_total: number;
  stock_excluded: number;
  available_running: number;
  delivery_wait_quantity: number;
  lot_count: number;
  nearest_expiration_date: string | null;
  etl_run_id: string;
  updated_at?: string | null;
}

export interface DomesticStockLotRow {
  raw_key: string;
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
  product_name: string | null;
  barcode: string | null;
  lot: string;
  expiration_date: string | null;
  warehouse_lname: string;
  location: string;
  bucket_code: string;
  bucket_name: string | null;
  include_in_running_stock: boolean;
  stock_quantity: number;
  delivery_wait_quantity: number;
  available_stock_quantity: number;
  etl_run_id: string;
  updated_at?: string | null;
}

export interface DomesticStockBucketSummary {
  warehouse_lname: string;
  rows: number;
  stock_quantity: number;
  available_stock_quantity: number;
  delivery_wait_quantity: number;
  include_in_running_stock: boolean;
  bucket_code: string;
  bucket_name: string | null;
}

export interface DomesticStockSummary {
  meta: {
    snapshot_date: string | null;
    warehouse_code: string;
    sku_count: number;
    running_sku_count: number;
    generated_at: string;
  };
  totals: {
    stock_running: number;
    stock_total: number;
    stock_excluded: number;
    available_running: number;
    delivery_wait_quantity: number;
    lot_count: number;
  };
  buckets: DomesticStockBucketSummary[];
  rows: DomesticStockSkuRow[];
}

interface FetchDomesticStockSummaryOptions {
  warehouseCode?: string;
  snapshotDate?: string | null;
  limit?: number;
}

interface FetchDomesticStockLotsOptions {
  warehouseCode?: string;
  snapshotDate?: string | null;
  productCode?: string | null;
  bucketCode?: string | null;
  includeExcluded?: boolean;
  limit?: number;
}

const DEFAULT_WAREHOUSE_CODE = "DESIGN_KR";
const SKU_TABLE = "mart_domestic_stock_sku_snapshot";
const LOT_TABLE = "mart_domestic_stock_lot_snapshot";
const DEFAULT_PAGE_SIZE = 1000;

let adminClient: SupabaseClient | null = null;

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return adminClient;
}

export async function fetchDomesticStockSummary(
  options: FetchDomesticStockSummaryOptions = {},
): Promise<DomesticStockSummary> {
  const supabase = createSupabaseAdminClient();
  const warehouseCode = options.warehouseCode ?? DEFAULT_WAREHOUSE_CODE;
  const snapshotDate = options.snapshotDate ?? (await fetchLatestDomesticSnapshotDate(supabase, warehouseCode));

  if (!snapshotDate) {
    return emptySummary(warehouseCode);
  }

  const limit = clampLimit(options.limit, 5000, 10000);
  // Fetch the whole snapshot page-by-page so totals/counts aggregate over ALL
  // SKUs; `limit` only caps the rows returned for display. A single limited
  // fetch here used to silently understate the summary once SKUs exceeded it.
  const allRows = await fetchAllSkuRows(supabase, warehouseCode, snapshotDate);
  const rows = allRows.slice(0, limit);
  const buckets = await fetchDomesticBucketSummary(supabase, warehouseCode, snapshotDate);

  return {
    meta: {
      snapshot_date: snapshotDate,
      warehouse_code: warehouseCode,
      sku_count: allRows.length,
      running_sku_count: allRows.filter((row) => num(row.stock_running) > 0).length,
      generated_at: new Date().toISOString(),
    },
    totals: {
      stock_running: sum(allRows, "stock_running"),
      stock_total: sum(allRows, "stock_total"),
      stock_excluded: sum(allRows, "stock_excluded"),
      available_running: sum(allRows, "available_running"),
      delivery_wait_quantity: sum(allRows, "delivery_wait_quantity"),
      lot_count: sum(allRows, "lot_count"),
    },
    buckets,
    rows,
  };
}

async function fetchAllSkuRows(
  supabase: SupabaseClient,
  warehouseCode: string,
  snapshotDate: string,
) {
  const rows: DomesticStockSkuRow[] = [];
  for (let from = 0; ; from += DEFAULT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(SKU_TABLE)
      .select("*")
      .eq("warehouse_code", warehouseCode)
      .eq("snapshot_date", snapshotDate)
      .order("stock_running", { ascending: false })
      .order("product_code", { ascending: true })
      .order("raw_key", { ascending: true })
      .range(from, from + DEFAULT_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as DomesticStockSkuRow[];
    rows.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchDomesticStockLots(options: FetchDomesticStockLotsOptions = {}) {
  const supabase = createSupabaseAdminClient();
  const warehouseCode = options.warehouseCode ?? DEFAULT_WAREHOUSE_CODE;
  const snapshotDate = options.snapshotDate ?? (await fetchLatestDomesticSnapshotDate(supabase, warehouseCode));

  if (!snapshotDate) {
    return {
      meta: {
        snapshot_date: null,
        warehouse_code: warehouseCode,
        product_code: options.productCode ?? null,
        rows: 0,
      },
      rows: [] as DomesticStockLotRow[],
    };
  }

  const limit = clampLimit(options.limit, 500, 5000);
  let query = supabase
    .from(LOT_TABLE)
    .select("*")
    .eq("warehouse_code", warehouseCode)
    .eq("snapshot_date", snapshotDate)
    .order("product_code", { ascending: true })
    .order("include_in_running_stock", { ascending: false })
    .order("expiration_date", { ascending: true })
    .order("lot", { ascending: true })
    .limit(limit);

  if (options.productCode) query = query.eq("product_code", options.productCode);
  if (options.bucketCode) query = query.eq("bucket_code", options.bucketCode);
  if (options.includeExcluded === false) query = query.eq("include_in_running_stock", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DomesticStockLotRow[];
  return {
    meta: {
      snapshot_date: snapshotDate,
      warehouse_code: warehouseCode,
      product_code: options.productCode ?? null,
      bucket_code: options.bucketCode ?? null,
      include_excluded: options.includeExcluded !== false,
      rows: rows.length,
      limit,
    },
    rows,
  };
}

async function fetchLatestDomesticSnapshotDate(supabase: SupabaseClient, warehouseCode: string) {
  const { data, error } = await supabase
    .from(SKU_TABLE)
    .select("snapshot_date")
    .eq("warehouse_code", warehouseCode)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.snapshot_date as string | undefined) ?? null;
}

async function fetchDomesticBucketSummary(
  supabase: SupabaseClient,
  warehouseCode: string,
  snapshotDate: string,
): Promise<DomesticStockBucketSummary[]> {
  const rows = await fetchAllLotRowsForBucketSummary(supabase, warehouseCode, snapshotDate);
  const buckets = new Map<string, DomesticStockBucketSummary>();

  for (const row of rows) {
    const key = row.warehouse_lname;
    const current =
      buckets.get(key) ??
      {
        warehouse_lname: row.warehouse_lname,
        rows: 0,
        stock_quantity: 0,
        available_stock_quantity: 0,
        delivery_wait_quantity: 0,
        include_in_running_stock: row.include_in_running_stock,
        bucket_code: row.bucket_code,
        bucket_name: row.bucket_name,
      };
    current.rows += 1;
    current.stock_quantity += num(row.stock_quantity);
    current.available_stock_quantity += num(row.available_stock_quantity);
    current.delivery_wait_quantity += num(row.delivery_wait_quantity);
    buckets.set(key, current);
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.include_in_running_stock !== b.include_in_running_stock) {
      return a.include_in_running_stock ? -1 : 1;
    }
    return b.stock_quantity - a.stock_quantity;
  });
}

async function fetchAllLotRowsForBucketSummary(
  supabase: SupabaseClient,
  warehouseCode: string,
  snapshotDate: string,
) {
  const rows: DomesticStockLotRow[] = [];
  for (let from = 0; ; from += DEFAULT_PAGE_SIZE) {
    const to = from + DEFAULT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(LOT_TABLE)
      .select(
        "warehouse_lname,bucket_code,bucket_name,include_in_running_stock,stock_quantity,available_stock_quantity,delivery_wait_quantity",
      )
      .eq("warehouse_code", warehouseCode)
      .eq("snapshot_date", snapshotDate)
      // Deterministic pagination: without ORDER BY, ranges can skip/repeat
      // rows across pages and corrupt the bucket totals.
      .order("raw_key", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as DomesticStockLotRow[];
    rows.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) break;
  }
  return rows;
}

function emptySummary(warehouseCode: string): DomesticStockSummary {
  return {
    meta: {
      snapshot_date: null,
      warehouse_code: warehouseCode,
      sku_count: 0,
      running_sku_count: 0,
      generated_at: new Date().toISOString(),
    },
    totals: {
      stock_running: 0,
      stock_total: 0,
      stock_excluded: 0,
      available_running: 0,
      delivery_wait_quantity: 0,
      lot_count: 0,
    },
    buckets: [],
    rows: [],
  };
}

function clampLimit(value: number | null | undefined, fallback: number, max: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function sum<T extends Record<K, unknown>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + num(row[key]), 0);
}

function num(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}
