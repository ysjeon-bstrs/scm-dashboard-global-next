import { createSupabaseAdminClient } from "./domesticStockQueries";

export interface AmazonStockRow {
  raw_key: string;
  resource_code: string;
  resource_name?: string | null;
  center: string;
  date?: string;
  snapshot_date?: string;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  fc_processing: number;
  latest_updated_at: string | null;
  created_at?: string | null;
}

export interface AmazonStockCenterSummary {
  center: string;
  snapshot_date: string;
  sku_count: number;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_incoming: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  fc_processing: number;
}

export interface AmazonStockSummary {
  meta: {
    latest_date: string | null;
    generated_at: string;
    row_count: number;
    center_count: number;
    sku_count: number;
  };
  totals: Omit<AmazonStockCenterSummary, "center" | "snapshot_date" | "sku_count"> & {
    sku_count: number;
  };
  centers: AmazonStockCenterSummary[];
  rows: AmazonStockRow[];
}

interface FetchAmazonStockSummaryOptions {
  date?: string | null;
  center?: string | null;
  limit?: number;
  source?: "new" | "legacy";
}

const AMAZON_MART_TABLE = "mart_amazon_inventory_snapshot";
const LEGACY_AMZ_STOCK_TABLE = "amz_stock";
const DEFAULT_LIMIT = 5000;

export async function fetchAmazonStockSummary(
  options: FetchAmazonStockSummaryOptions = {},
): Promise<AmazonStockSummary> {
  const supabase = createSupabaseAdminClient();
  const table = options.source === "legacy" ? LEGACY_AMZ_STOCK_TABLE : AMAZON_MART_TABLE;
  const dateColumn = options.source === "legacy" ? "date" : "snapshot_date";
  const latestDate = options.date ?? (await fetchLatestAmazonStockDate(options.source));

  if (!latestDate) return emptySummary();

  const limit = clampLimit(options.limit, DEFAULT_LIMIT, 10000);
  let query = supabase
    .from(table)
    .select("*")
    .eq(dateColumn, latestDate)
    .order("center", { ascending: true })
    .order("stock_sellable", { ascending: false })
    .limit(limit);

  if (options.center && options.center !== "ALL") query = query.eq("center", options.center);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as AmazonStockRow[]).map(normalizeRow);
  const centers = buildCenterSummary(rows);
  const skuCount = new Set(rows.map((row) => row.resource_code)).size;

  return {
    meta: {
      latest_date: latestDate,
      generated_at: new Date().toISOString(),
      row_count: rows.length,
      center_count: centers.length,
      sku_count: skuCount,
    },
    totals: {
      sku_count: skuCount,
      stock_sellable: sum(rows, "stock_sellable"),
      stock_available: sum(rows, "stock_available"),
      pending_fc: sum(rows, "pending_fc"),
      stock_incoming: sumIncoming(rows),
      stock_expected: sum(rows, "stock_expected"),
      stock_processing: sum(rows, "stock_processing"),
      stock_readytoship: sum(rows, "stock_readytoship"),
      customer_order: sum(rows, "customer_order"),
      fc_processing: sum(rows, "fc_processing"),
    },
    centers,
    rows,
  };
}

export async function fetchLatestAmazonStockDate(source: "new" | "legacy" = "new") {
  const supabase = createSupabaseAdminClient();
  const table = source === "legacy" ? LEGACY_AMZ_STOCK_TABLE : AMAZON_MART_TABLE;
  const dateColumn = source === "legacy" ? "date" : "snapshot_date";
  const { data, error } = await supabase
    .from(table)
    .select(dateColumn)
    .order(dateColumn, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (Object.values(data)[0] as string | undefined) ?? null : null;
}

function buildCenterSummary(rows: AmazonStockRow[]) {
  const byCenter = new Map<string, AmazonStockCenterSummary>();

  for (const row of rows) {
    const current =
      byCenter.get(row.center) ??
      {
        center: row.center,
        snapshot_date: row.date ?? row.snapshot_date ?? "",
        sku_count: 0,
        stock_sellable: 0,
        stock_available: 0,
        pending_fc: 0,
        stock_incoming: 0,
        stock_expected: 0,
        stock_processing: 0,
        stock_readytoship: 0,
        customer_order: 0,
        fc_processing: 0,
      };

    current.sku_count += 1;
    current.stock_sellable += num(row.stock_sellable);
    current.stock_available += num(row.stock_available);
    current.pending_fc += num(row.pending_fc);
    current.stock_expected += num(row.stock_expected);
    current.stock_processing += num(row.stock_processing);
    current.stock_readytoship += num(row.stock_readytoship);
    current.stock_incoming += num(row.stock_expected) + num(row.stock_processing) + num(row.stock_readytoship);
    current.customer_order += num(row.customer_order);
    current.fc_processing += num(row.fc_processing);

    byCenter.set(row.center, current);
  }

  return Array.from(byCenter.values()).sort((a, b) => a.center.localeCompare(b.center));
}

function normalizeRow(row: AmazonStockRow): AmazonStockRow {
  return {
    ...row,
    date: row.date ?? row.snapshot_date,
    stock_sellable: num(row.stock_sellable),
    stock_available: num(row.stock_available),
    pending_fc: num(row.pending_fc),
    stock_expected: num(row.stock_expected),
    stock_processing: num(row.stock_processing),
    stock_readytoship: num(row.stock_readytoship),
    customer_order: num(row.customer_order),
    fc_processing: num(row.fc_processing),
  };
}

function emptySummary(): AmazonStockSummary {
  return {
    meta: {
      latest_date: null,
      generated_at: new Date().toISOString(),
      row_count: 0,
      center_count: 0,
      sku_count: 0,
    },
    totals: {
      sku_count: 0,
      stock_sellable: 0,
      stock_available: 0,
      pending_fc: 0,
      stock_incoming: 0,
      stock_expected: 0,
      stock_processing: 0,
      stock_readytoship: 0,
      customer_order: 0,
      fc_processing: 0,
    },
    centers: [],
    rows: [],
  };
}

function sumIncoming(rows: AmazonStockRow[]) {
  return rows.reduce(
    (total, row) => total + num(row.stock_expected) + num(row.stock_processing) + num(row.stock_readytoship),
    0,
  );
}

function sum<T extends Record<K, unknown>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + num(row[key]), 0);
}

function num(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampLimit(value: number | null | undefined, fallback: number, max: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
