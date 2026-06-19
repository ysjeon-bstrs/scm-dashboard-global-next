import {
  buildAmazonDohRows,
  getAmazonDohSalesWindowEnd,
  type AmazonDohInventoryInput,
  type AmazonDohRow,
  type AmazonDohSalesInput,
} from "../../../src/lib/scm-dashboard/amazonDohEtl.ts";

type CliOptions = {
  apply: boolean;
  date: string;
  center?: string;
  compareLegacy: boolean;
};

type SupabaseEnv = {
  url: string;
  apiKey: string;
};

type TableName =
  | "mart_amazon_inventory_snapshot"
  | "mart_amazon_sales_daily"
  | "mart_amazon_doh_snapshot"
  | "etl_run_logs"
  | "amz_doh";

type CenterSummary = Record<string, {
  rows: number;
  send_now: number;
  send_soon: number;
  watch: number;
  watch_incoming: number;
  ok: number;
  no_sales: number;
  required_qty_net: number;
  recommended_ship_qty: number;
}>;

const PIPELINE = "amazon_doh_snapshot";
const DEFAULT_BATCH_SIZE = 500;
const VALID_CENTERS = new Set(["AMZUS", "AMZUK", "AMZDE", "AMZAE"]);
const TARGET_SALES_CHANNELS = [
  "Amazon.com",
  "Amazon.co.uk",
  "Amazon.de",
  "Amazon.fr",
  "Amazon.es",
  "Amazon.it",
  "Amazon.ae",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseEnv({ requireServiceRole: options.apply });
  const etlRunId = buildEtlRunId();
  const salesWindowEnd = getAmazonDohSalesWindowEnd(options.date);
  const salesWindowStart = addDays(salesWindowEnd, -89);

  const inventoryRows = await fetchInventoryRows(supabase, options);
  const salesRows = await fetchSalesRows(supabase, {
    startDate: salesWindowStart,
    endDate: salesWindowEnd,
    center: options.center,
  });
  const payload = buildAmazonDohRows({
    inventory: inventoryRows,
    sales: salesRows,
    snapshotDate: options.date,
    etlRunId,
  });
  const summary = summarizePayload(payload);
  const legacy = options.compareLegacy ? await fetchLegacySummary(supabase, options.date, options.center) : null;
  const parity = legacy ? compareLegacySummary(summary.byCenter, legacy.byCenter) : [];

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    etl_run_id: etlRunId,
    snapshot_date: options.date,
    sales_window_start_date: salesWindowStart,
    sales_window_end_date: salesWindowEnd,
    center: options.center ?? "ALL",
    inventoryRows: inventoryRows.length,
    salesRows: salesRows.length,
    transformedRows: payload.length,
    new_mart: summary,
    legacy_amz_doh: legacy,
    parity,
    samples: payload.slice(0, 5),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Apply scripts/etl/amazon/amazon-doh-schema.sql and sales mart first, then re-run with --apply.");
    return;
  }

  const writeResult = await applyToSupabase(supabase, payload, {
    etlRunId,
    snapshotDate: options.date,
    summary: { new_mart: summary, legacy_amz_doh: legacy, parity },
  });
  console.log(JSON.stringify({ status: "SUCCESS", ...writeResult }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const options: CliOptions = { apply: false, date: today, compareLegacy: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--compare-legacy") options.compareLegacy = true;
    else if (arg === "--date") options.date = requireArg(args, ++i, "--date");
    else if (arg === "--center") options.center = requireArg(args, ++i, "--center").toUpperCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  if (options.center && !VALID_CENTERS.has(options.center)) {
    throw new Error(`--center must be one of ${Array.from(VALID_CENTERS).join(", ")}`);
  }
  return options;
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getSupabaseEnv({ requireServiceRole = false }: { requireServiceRole?: boolean } = {}): SupabaseEnv {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (requireServiceRole && !serviceRole) {
    throw new Error("Missing required env var: SUPABASE_SERVICE_ROLE_KEY. Apply mode writes ETL marts and must not use the browser anon key.");
  }
  return { url, apiKey: serviceRole || requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

async function fetchInventoryRows(env: SupabaseEnv, options: CliOptions): Promise<AmazonDohInventoryInput[]> {
  const params = new URLSearchParams();
  params.set("snapshot_date", `eq.${options.date}`);
  params.set("select", "snapshot_date,center,resource_code,stock_sellable,stock_available,pending_fc,stock_expected,stock_processing,stock_readytoship,customer_order");
  params.set("order", "center.asc,resource_code.asc");
  if (options.center) params.set("center", `eq.${options.center}`);

  const rows = await fetchAll<AmazonDohInventoryInput>(env, "mart_amazon_inventory_snapshot", params);
  return rows;
}

async function fetchSalesRows(
  env: SupabaseEnv,
  options: { startDate: string; endDate: string; center?: string },
): Promise<AmazonDohSalesInput[]> {
  const params = new URLSearchParams();
  params.set("order_date_pt", `gte.${options.startDate}`);
  params.append("order_date_pt", `lte.${options.endDate}`);
  params.set("select", "order_date_pt,center,resource_code,resource_name,qty_total");
  params.set("sales_channel", `in.(${TARGET_SALES_CHANNELS.map((channel) => `\"${channel}\"`).join(",")})`);
  params.set("order", "order_date_pt.asc,center.asc,resource_code.asc");
  if (options.center) params.set("center", `eq.${options.center}`);

  return fetchAll<AmazonDohSalesInput>(env, "mart_amazon_sales_daily", params);
}

async function fetchLegacySummary(env: SupabaseEnv, snapshotDate: string, center?: string) {
  const params = new URLSearchParams();
  params.set("snapshot_date", `eq.${snapshotDate}`);
  params.set("select", "center,status,required_qty");
  if (center) params.set("center", `eq.${center}`);
  const rows = await fetchAll<{ center: string; status: string; required_qty: number }>(env, "amz_doh", params);
  const byCenter: Record<string, { rows: number; required_qty: number; statuses: Record<string, number> }> = {};
  for (const row of rows) {
    const current = byCenter[row.center] ?? { rows: 0, required_qty: 0, statuses: {} };
    current.rows += 1;
    current.required_qty += Number(row.required_qty ?? 0);
    current.statuses[row.status] = (current.statuses[row.status] ?? 0) + 1;
    byCenter[row.center] = current;
  }
  return { row_count: rows.length, byCenter };
}

async function fetchAll<T>(env: SupabaseEnv, table: TableName, params: URLSearchParams) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += DEFAULT_BATCH_SIZE) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(DEFAULT_BATCH_SIZE));
    pageParams.set("offset", String(offset));
    const page = await supabaseGet<T[]>(env, table, pageParams);
    rows.push(...page);
    if (page.length < DEFAULT_BATCH_SIZE) break;
  }
  return rows;
}

async function supabaseGet<T>(env: SupabaseEnv, table: TableName, params: URLSearchParams): Promise<T> {
  const url = `${env.url}/rest/v1/${table}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

function summarizePayload(rows: AmazonDohRow[]) {
  const byCenter: CenterSummary = {};
  for (const row of rows) {
    const current = byCenter[row.center] ?? {
      rows: 0,
      send_now: 0,
      send_soon: 0,
      watch: 0,
      watch_incoming: 0,
      ok: 0,
      no_sales: 0,
      required_qty_net: 0,
      recommended_ship_qty: 0,
    };
    current.rows += 1;
    current.required_qty_net += row.required_qty_net;
    current.recommended_ship_qty += row.recommended_ship_qty;
    if (row.status === "CRITICAL_SEND_NOW") current.send_now += 1;
    else if (row.status === "SEND_SOON") current.send_soon += 1;
    else if (row.status === "WATCH") current.watch += 1;
    else if (row.status === "WATCH_INCOMING") current.watch_incoming += 1;
    else if (row.status === "NO_SALES") current.no_sales += 1;
    else current.ok += 1;
    byCenter[row.center] = current;
  }
  return { row_count: rows.length, byCenter };
}

function compareLegacySummary(
  newByCenter: CenterSummary,
  legacyByCenter: Record<string, { rows: number; required_qty: number; statuses: Record<string, number> }>,
) {
  const centers = new Set([...Object.keys(newByCenter), ...Object.keys(legacyByCenter)]);
  return Array.from(centers).sort().map((center) => {
    const next = newByCenter[center];
    const legacy = legacyByCenter[center];
    return {
      center,
      row_delta: (next?.rows ?? 0) - (legacy?.rows ?? 0),
      required_qty_note: "new uses net required_qty and calendar zero-filled velocity; legacy required_qty is diagnostic only",
      new_required_qty_net: next?.required_qty_net ?? 0,
      legacy_required_qty: legacy?.required_qty ?? 0,
      new_statuses: next ?? null,
      legacy_statuses: legacy?.statuses ?? null,
    };
  });
}

async function applyToSupabase(
  env: SupabaseEnv,
  rows: AmazonDohRow[],
  context: { etlRunId: string; snapshotDate: string; summary: unknown },
) {
  await writeEtlLog(env, {
    etl_run_id: context.etlRunId,
    pipeline: PIPELINE,
    status: "RUNNING",
    snapshot_date: context.snapshotDate,
    source_rows: rows.length,
    raw_rows: 0,
    mart_lot_rows: 0,
    mart_sku_rows: rows.length,
    summary: context.summary,
  });
  try {
    const written = await upsertBatches(env, "mart_amazon_doh_snapshot", rows, "snapshot_date,center,resource_code");
    await writeEtlLog(env, {
      etl_run_id: context.etlRunId,
      pipeline: PIPELINE,
      status: "SUCCESS",
      snapshot_date: context.snapshotDate,
      source_rows: rows.length,
      raw_rows: 0,
      mart_lot_rows: 0,
      mart_sku_rows: written,
      summary: context.summary,
      finished_at: new Date().toISOString(),
    });
    return { martWritten: written };
  } catch (error) {
    await writeEtlLog(env, {
      etl_run_id: context.etlRunId,
      pipeline: PIPELINE,
      status: "FAILED",
      snapshot_date: context.snapshotDate,
      source_rows: rows.length,
      raw_rows: 0,
      mart_lot_rows: 0,
      mart_sku_rows: 0,
      summary: context.summary,
      error_message: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    }).catch(() => undefined);
    throw error;
  }
}

async function upsertBatches<T extends object>(env: SupabaseEnv, table: TableName, rows: T[], onConflict: string) {
  let written = 0;
  for (let i = 0; i < rows.length; i += DEFAULT_BATCH_SIZE) {
    const batch = rows.slice(i, i + DEFAULT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await supabasePost(env, table, {
      query: `on_conflict=${encodeURIComponent(onConflict)}`,
      headers: { Prefer: "resolution=merge-duplicates" },
      body: batch,
    });
    written += batch.length;
  }
  return written;
}

async function writeEtlLog(env: SupabaseEnv, row: Record<string, unknown>) {
  await supabasePost(env, "etl_run_logs", {
    query: "on_conflict=etl_run_id",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: row,
  });
}

async function supabasePost(
  env: SupabaseEnv,
  table: TableName,
  options: { query?: string; headers?: Record<string, string>; body: unknown },
) {
  const url = `${env.url}/rest/v1/${table}${options.query ? `?${options.query}` : ""}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
      "content-type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} ${response.status}: ${text}`);
  }
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function buildEtlRunId() {
  return `${PIPELINE}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
