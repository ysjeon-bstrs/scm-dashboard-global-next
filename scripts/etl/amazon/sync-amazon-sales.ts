import * as mysql from "mysql2/promise";

import {
  transformAmazonSalesRows,
  type AmazonSalesDailyRow,
  type AmazonSalesRawRow,
} from "../../../src/lib/scm-dashboard/amazonSalesEtl.ts";

type CliOptions = {
  apply: boolean;
  schemaCheck: boolean;
  startDate: string;
  endDate: string;
  limit?: number;
};

type CrewEnv = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

type SupabaseEnv = {
  url: string;
  apiKey: string;
};

type TableName = "mart_amazon_sales_daily" | "etl_run_logs";

type CenterSummary = Record<string, {
  rows: number;
  qty_total: number;
  qty_shipped: number;
  qty_unshipped: number;
  source_order_count: number;
}>;

const DEFAULT_CREW_DB = "boosters";
const DEFAULT_BATCH_SIZE = 500;
const PIPELINE = "amazon_sales_daily";
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
  const crewEnv = getCrewEnv();

  if (options.schemaCheck) {
    await runSchemaCheck(crewEnv);
    return;
  }

  const etlRunId = buildEtlRunId();
  const rawRows = await extractAmazonSalesRows(crewEnv, options);
  const payload = transformAmazonSalesRows(rawRows, etlRunId);
  const summary = summarizePayload(payload);
  const unmapped = summarizeUnmapped(rawRows);

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    etl_run_id: etlRunId,
    start_date: options.startDate,
    end_date: options.endDate,
    sourceRows: rawRows.length,
    transformedRows: payload.length,
    unmapped,
    new_mart: summary,
    samples: {
      raw: rawRows.slice(0, 3),
      mart: payload.slice(0, 3),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Apply scripts/etl/amazon/amazon-doh-schema.sql first, then re-run with --apply.");
    return;
  }

  const supabase = getSupabaseEnv({ requireServiceRole: true });
  const writeResult = await applyToSupabase(supabase, payload, {
    etlRunId,
    startDate: options.startDate,
    endDate: options.endDate,
    summary: { new_mart: summary, unmapped },
  });
  console.log(JSON.stringify({ status: "SUCCESS", ...writeResult }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const options: CliOptions = {
    apply: false,
    schemaCheck: false,
    startDate: today,
    endDate: today,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--schema-check") options.schemaCheck = true;
    else if (arg === "--start-date") options.startDate = requireArg(args, ++i, "--start-date");
    else if (arg === "--end-date") options.endDate = requireArg(args, ++i, "--end-date");
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, "--limit"));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const [label, value] of [["--start-date", options.startDate], ["--end-date", options.endDate]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got ${value}`);
  }

  if (options.startDate > options.endDate) throw new Error("--start-date must be <= --end-date");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
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

function getCrewEnv(): CrewEnv {
  return {
    host: requireEnv("BOOSTERS_CREW_MYSQL_HOST"),
    port: Number(process.env.BOOSTERS_CREW_MYSQL_PORT || 3306),
    database: process.env.BOOSTERS_CREW_MYSQL_DATABASE || DEFAULT_CREW_DB,
    user: requireEnv("BOOSTERS_CREW_MYSQL_USER"),
    password: requireEnv("BOOSTERS_CREW_MYSQL_PASSWORD"),
  };
}

function getSupabaseEnv({ requireServiceRole = false }: { requireServiceRole?: boolean } = {}): SupabaseEnv {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (requireServiceRole && !serviceRole) {
    throw new Error("Missing required env var: SUPABASE_SERVICE_ROLE_KEY. Apply mode writes ETL marts and must not use the browser anon key.");
  }
  return { url, apiKey: serviceRole || requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

async function connectCrew(env: CrewEnv) {
  return mysql.createConnection({
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    connectTimeout: 10_000,
    timezone: "+00:00",
  });
}

async function runSchemaCheck(env: CrewEnv) {
  const conn = await connectCrew(env);
  try {
    const requiredColumns = new Map<string, string[]>([
      ["amazon_seller_report_order_infos", ["id", "marketplaceid", "amazon_order_id", "real_purchase_date", "order_status", "sales_channel"]],
      ["amazon_seller_report_order_detail_infos", ["id", "amazon_seller_report_order_info_id", "asin", "quantity"]],
      ["boosters_item_groups", ["resource_code", "resource_name", "amazon_seller_asin"]],
    ]);

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name IN ('amazon_seller_report_order_infos', 'amazon_seller_report_order_detail_infos', 'boosters_item_groups')
        ORDER BY table_name, ordinal_position`,
      [env.database],
    );

    const actual = new Map<string, Set<string>>();
    for (const row of rows) {
      const table = String(row.table_name);
      const column = String(row.column_name);
      if (!actual.has(table)) actual.set(table, new Set());
      actual.get(table)?.add(column);
    }

    const result = Array.from(requiredColumns.entries()).map(([table, required]) => {
      const columns = actual.get(table) ?? new Set<string>();
      return {
        table,
        exists: columns.size > 0,
        missingColumns: required.filter((column) => !columns.has(column)),
        observedColumnCount: columns.size,
      };
    });

    console.log(JSON.stringify({ database: env.database, schemaCheck: result }, null, 2));
  } finally {
    await conn.end();
  }
}

async function extractAmazonSalesRows(
  env: CrewEnv,
  options: CliOptions,
): Promise<AmazonSalesRawRow[]> {
  const conn = await connectCrew(env);
  try {
    const sql = `
      SELECT
        DATE(oi.real_purchase_date) AS order_date_pt,
        oi.marketplaceid,
        COALESCE(oi.sales_channel, '') AS sales_channel,
        od.asin,
        g.resource_code,
        g.resource_name,
        oi.order_status,
        COALESCE(od.quantity, 0) AS quantity,
        oi.amazon_order_id AS order_id,
        od.id AS detail_id,
        oi.real_purchase_date AS purchase_at
      FROM amazon_seller_report_order_infos oi
      JOIN amazon_seller_report_order_detail_infos od
        ON od.amazon_seller_report_order_info_id = oi.id
      LEFT JOIN boosters_item_groups g
        ON od.asin = g.amazon_seller_asin
       AND g.resource_code LIKE 'BA0%'
      WHERE DATE(oi.real_purchase_date) BETWEEN ? AND ?
        AND oi.sales_channel IN (${TARGET_SALES_CHANNELS.map(() => "?").join(", ")})
        AND COALESCE(od.quantity, 0) > 0
      ORDER BY order_date_pt, oi.marketplaceid, od.asin, g.resource_code
      ${options.limit ? "LIMIT ?" : ""}
    `;

    const params: Array<string | number> = [
      options.startDate,
      options.endDate,
      ...TARGET_SALES_CHANNELS,
    ];
    if (options.limit) params.push(options.limit);

    const [rows] = await conn.query<mysql.RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      order_date_pt: String(row.order_date_pt ?? ""),
      marketplaceid: stringOrNull(row.marketplaceid),
      sales_channel: stringOrNull(row.sales_channel),
      asin: stringOrNull(row.asin),
      resource_code: stringOrNull(row.resource_code),
      resource_name: stringOrNull(row.resource_name),
      order_status: stringOrNull(row.order_status),
      quantity: Number(row.quantity ?? 0),
      order_id: stringOrNull(row.order_id),
      detail_id: stringOrNull(row.detail_id),
      purchase_at: row.purchase_at instanceof Date ? row.purchase_at.toISOString() : stringOrNull(row.purchase_at),
    }));
  } finally {
    await conn.end();
  }
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function summarizePayload(rows: AmazonSalesDailyRow[]) {
  const byCenter: CenterSummary = {};
  const dates = new Set<string>();
  const skuSet = new Set<string>();

  for (const row of rows) {
    dates.add(row.order_date_pt);
    skuSet.add(row.resource_code);
    const current = byCenter[row.center] ?? {
      rows: 0,
      qty_total: 0,
      qty_shipped: 0,
      qty_unshipped: 0,
      source_order_count: 0,
    };
    current.rows += 1;
    current.qty_total += row.qty_total;
    current.qty_shipped += row.qty_shipped;
    current.qty_unshipped += row.qty_unshipped;
    current.source_order_count += row.source_order_count;
    byCenter[row.center] = current;
  }

  return {
    row_count: rows.length,
    date_count: dates.size,
    sku_count: skuSet.size,
    byCenter,
  };
}

function summarizeUnmapped(rawRows: AmazonSalesRawRow[]) {
  const unmapped = rawRows.filter((row) => !row.resource_code);
  const byAsin = new Map<string, number>();
  for (const row of unmapped) {
    const asin = String(row.asin ?? "").trim() || "<blank>";
    byAsin.set(asin, (byAsin.get(asin) ?? 0) + 1);
  }
  return {
    row_count: unmapped.length,
    asin_count: byAsin.size,
    sample_asins: Array.from(byAsin.entries()).slice(0, 10).map(([asin, rows]) => ({ asin, rows })),
  };
}

async function applyToSupabase(
  env: SupabaseEnv,
  rows: AmazonSalesDailyRow[],
  context: { etlRunId: string; startDate: string; endDate: string; summary: unknown },
) {
  await writeEtlLog(env, {
    etl_run_id: context.etlRunId,
    pipeline: PIPELINE,
    status: "RUNNING",
    snapshot_date: context.endDate,
    source_rows: rows.length,
    raw_rows: 0,
    mart_lot_rows: 0,
    mart_sku_rows: rows.length,
    summary: context.summary,
  });

  try {
    const written = await upsertBatches(env, "mart_amazon_sales_daily", rows, "order_date_pt,center,marketplaceid,sales_channel,asin,resource_code");
    await writeEtlLog(env, {
      etl_run_id: context.etlRunId,
      pipeline: PIPELINE,
      status: "SUCCESS",
      snapshot_date: context.endDate,
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
      snapshot_date: context.endDate,
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
    await supabaseRequest(env, table, {
      method: "POST",
      query: `on_conflict=${encodeURIComponent(onConflict)}`,
      headers: { Prefer: "resolution=merge-duplicates" },
      body: batch,
    });
    written += batch.length;
  }
  return written;
}

async function writeEtlLog(env: SupabaseEnv, row: Record<string, unknown>) {
  await supabaseRequest(env, "etl_run_logs", {
    method: "POST",
    query: "on_conflict=etl_run_id",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: row,
  });
}

async function supabaseRequest(
  env: SupabaseEnv,
  table: TableName,
  options: { method: "POST"; query?: string; headers?: Record<string, string>; body: unknown },
) {
  const url = `${env.url}/rest/v1/${table}${options.query ? `?${options.query}` : ""}`;
  const response = await fetch(url, {
    method: options.method,
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

function buildEtlRunId() {
  return `${PIPELINE}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
