import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

function createSupabaseAdminClient() {
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

export type AmazonDohCenterFilter = "ALL" | "AMZUS" | "AMZUK" | "AMZDE" | "AMZAE";

export type AmazonDohStatus =
  | "CRITICAL_SEND_NOW"
  | "SEND_SOON"
  | "WATCH_INCOMING"
  | "WATCH"
  | "OK"
  | "NO_SALES";

export interface AmazonDohSummaryRow {
  raw_key: string;
  snapshot_date: string;
  sales_window_end_date: string;
  center: string;
  resource_code: string;
  resource_name: string | null;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_incoming: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  qty_1d: number;
  qty_7d: number;
  qty_30d: number;
  qty_90d: number;
  vel_7d: number;
  vel_30d: number;
  vel_90d: number;
  doh_7d: number;
  doh_30d: number;
  doh_90d: number;
  target_days: number;
  warn_days: number;
  danger_days: number;
  fee_risk_days: number;
  required_qty_gross: number;
  required_qty_net: number;
  recommended_ship_qty: number;
  gap_45d: number;
  status: AmazonDohStatus;
  fee_risk: boolean;
  urgency_rank: number;
  action_label: string;
  action_reason: string;
  etl_run_id: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AmazonDohCenterSummary {
  center: string;
  row_count: number;
  send_now_count: number;
  send_soon_count: number;
  watch_count: number;
  watch_incoming_count: number;
  ok_count: number;
  no_sales_count: number;
  fee_risk_count: number;
  stock_sellable: number;
  stock_incoming: number;
  required_qty_net: number;
  recommended_ship_qty: number;
  median_doh_7d: number;
}

export interface AmazonDohSummary {
  meta: {
    snapshot_date: string | null;
    sales_window_end_date: string | null;
    selected_center: AmazonDohCenterFilter;
    generated_at: string;
    row_count: number;
    center_count: number;
  };
  totals: {
    send_now_count: number;
    send_soon_count: number;
    watch_count: number;
    watch_incoming_count: number;
    ok_count: number;
    no_sales_count: number;
    fee_risk_count: number;
    stock_sellable: number;
    stock_incoming: number;
    total_required_net: number;
    total_recommended_ship_qty: number;
  };
  centers: AmazonDohCenterSummary[];
  actions: AmazonDohSummaryRow[];
}

interface FetchAmazonDohSummaryOptions {
  snapshotDate?: string | null;
  center?: string | null;
  limit?: number;
}

const DOH_TABLE = "mart_amazon_doh_snapshot";
const DEFAULT_LIMIT = 5000;
const CENTER_ORDER = ["AMZUS", "AMZUK", "AMZDE", "AMZAE"];

export async function fetchAmazonDohSummary(
  options: FetchAmazonDohSummaryOptions = {},
): Promise<AmazonDohSummary> {
  const supabase = createSupabaseAdminClient();
  const snapshotDate = options.snapshotDate ?? (await fetchLatestAmazonDohSnapshotDate());
  const selectedCenter = normalizeCenter(options.center);

  if (!snapshotDate) return buildAmazonDohSummary([], { selectedCenter });

  const limit = clampLimit(options.limit, DEFAULT_LIMIT, 10000);
  let query = supabase
    .from(DOH_TABLE)
    .select("*")
    .eq("snapshot_date", snapshotDate)
    .order("urgency_rank", { ascending: true })
    .order("required_qty_net", { ascending: false })
    .order("doh_7d", { ascending: true })
    .limit(limit);

  if (selectedCenter !== "ALL") query = query.eq("center", selectedCenter);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return buildAmazonDohSummary((data ?? []).map(normalizeRow), { selectedCenter });
}

export async function fetchLatestAmazonDohSnapshotDate() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(DOH_TABLE)
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.snapshot_date as string | null | undefined ?? null;
}

export function buildAmazonDohSummary(
  rows: AmazonDohSummaryRow[],
  { selectedCenter }: { selectedCenter: AmazonDohCenterFilter },
): AmazonDohSummary {
  const scopedRows = selectedCenter === "ALL" ? rows : rows.filter((row) => row.center === selectedCenter);
  const normalizedRows = scopedRows.map(normalizeRow).sort(compareActionRows);
  const centers = buildCenterSummaries(rows.map(normalizeRow));

  return {
    meta: {
      snapshot_date: normalizedRows[0]?.snapshot_date ?? rows[0]?.snapshot_date ?? null,
      sales_window_end_date: normalizedRows[0]?.sales_window_end_date ?? rows[0]?.sales_window_end_date ?? null,
      selected_center: selectedCenter,
      generated_at: new Date().toISOString(),
      row_count: normalizedRows.length,
      center_count: selectedCenter === "ALL" ? centers.length : normalizedRows.length > 0 ? 1 : 0,
    },
    totals: buildTotals(normalizedRows),
    centers,
    actions: normalizedRows,
  };
}

function buildCenterSummaries(rows: AmazonDohSummaryRow[]) {
  const byCenter = new Map<string, AmazonDohSummaryRow[]>();
  for (const row of rows) {
    const current = byCenter.get(row.center) ?? [];
    current.push(row);
    byCenter.set(row.center, current);
  }

  return Array.from(byCenter.entries())
    .map(([center, centerRows]) => {
      const totals = buildTotals(centerRows);
      return {
        center,
        row_count: centerRows.length,
        send_now_count: totals.send_now_count,
        send_soon_count: totals.send_soon_count,
        watch_count: totals.watch_count,
        watch_incoming_count: totals.watch_incoming_count,
        ok_count: totals.ok_count,
        no_sales_count: totals.no_sales_count,
        fee_risk_count: totals.fee_risk_count,
        stock_sellable: totals.stock_sellable,
        stock_incoming: totals.stock_incoming,
        required_qty_net: totals.total_required_net,
        recommended_ship_qty: totals.total_recommended_ship_qty,
        median_doh_7d: median(centerRows.map((row) => num(row.doh_7d)).filter((value) => value < 999)),
      } satisfies AmazonDohCenterSummary;
    })
    .sort((a, b) => CENTER_ORDER.indexOf(a.center) - CENTER_ORDER.indexOf(b.center));
}

function buildTotals(rows: AmazonDohSummaryRow[]) {
  return {
    send_now_count: countStatus(rows, "CRITICAL_SEND_NOW"),
    send_soon_count: countStatus(rows, "SEND_SOON"),
    watch_count: countStatus(rows, "WATCH"),
    watch_incoming_count: countStatus(rows, "WATCH_INCOMING"),
    ok_count: countStatus(rows, "OK"),
    no_sales_count: countStatus(rows, "NO_SALES"),
    fee_risk_count: rows.filter((row) => row.fee_risk).length,
    stock_sellable: sum(rows, "stock_sellable"),
    stock_incoming: sum(rows, "stock_incoming"),
    total_required_net: sum(rows, "required_qty_net"),
    total_recommended_ship_qty: sum(rows, "recommended_ship_qty"),
  };
}

function normalizeCenter(value: string | null | undefined): AmazonDohCenterFilter {
  const center = String(value ?? "AMZUS").toUpperCase();
  return (["ALL", ...CENTER_ORDER] as string[]).includes(center) ? center as AmazonDohCenterFilter : "AMZUS";
}

function compareActionRows(a: AmazonDohSummaryRow, b: AmazonDohSummaryRow) {
  return (
    num(a.urgency_rank) - num(b.urgency_rank) ||
    num(b.required_qty_net) - num(a.required_qty_net) ||
    num(a.doh_7d) - num(b.doh_7d) ||
    `${a.center}|${a.resource_code}`.localeCompare(`${b.center}|${b.resource_code}`)
  );
}

function normalizeRow(row: AmazonDohSummaryRow): AmazonDohSummaryRow {
  return {
    ...row,
    stock_sellable: num(row.stock_sellable),
    stock_available: num(row.stock_available),
    pending_fc: num(row.pending_fc),
    stock_incoming: num(row.stock_incoming),
    stock_expected: num(row.stock_expected),
    stock_processing: num(row.stock_processing),
    stock_readytoship: num(row.stock_readytoship),
    customer_order: num(row.customer_order),
    qty_1d: num(row.qty_1d),
    qty_7d: num(row.qty_7d),
    qty_30d: num(row.qty_30d),
    qty_90d: num(row.qty_90d),
    vel_7d: num(row.vel_7d),
    vel_30d: num(row.vel_30d),
    vel_90d: num(row.vel_90d),
    doh_7d: num(row.doh_7d),
    doh_30d: num(row.doh_30d),
    doh_90d: num(row.doh_90d),
    target_days: num(row.target_days),
    warn_days: num(row.warn_days),
    danger_days: num(row.danger_days),
    fee_risk_days: num(row.fee_risk_days),
    required_qty_gross: num(row.required_qty_gross),
    required_qty_net: num(row.required_qty_net),
    recommended_ship_qty: num(row.recommended_ship_qty),
    gap_45d: num(row.gap_45d),
    urgency_rank: num(row.urgency_rank),
    fee_risk: Boolean(row.fee_risk),
  };
}

function countStatus(rows: AmazonDohSummaryRow[], status: AmazonDohStatus) {
  return rows.filter((row) => row.status === status).length;
}

function sum<T extends Record<K, unknown>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + num(row[key]), 0);
}

function median(values: number[]) {
  if (values.length === 0) return 999;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return round(sorted[middle], 2);
  return round((sorted[middle - 1] + sorted[middle]) / 2, 2);
}

function num(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clampLimit(value: number | null | undefined, fallback: number, max: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
