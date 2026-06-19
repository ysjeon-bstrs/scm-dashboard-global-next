import * as mysql from "mysql2/promise";

import {
  transformDomesticStockRows,
  type DomesticRawSnapshotUpsertRow,
  type DomesticLotSnapshotUpsertRow,
  type DomesticSkuSnapshotUpsertRow,
  type DomesticStockRawRow,
} from "../../../src/lib/scm-dashboard/domesticStockEtl.ts";

type CliOptions = {
  apply: boolean;
  schemaCheck: boolean;
  database?: string;
  date?: string;
  limit?: number;
};

type SourceEnv = {
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

type TableName =
  | "raw_domestic_stock_location_snapshots"
  | "mart_domestic_stock_lot_snapshot"
  | "mart_domestic_stock_sku_snapshot"
  | "etl_run_logs";

const SOURCE_TABLE = "nansoft_get_stock_location_infos";
const WAREHOUSE_CODE = "DESIGN_KR";
const SOURCE_SYSTEM = "nansoft";
const DEFAULT_BATCH_SIZE = 500;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceEnv = getSourceEnv(options);

  if (options.schemaCheck) {
    await runSchemaCheck(sourceEnv);
    return;
  }

  const etlRunId = buildEtlRunId();
  const sourceRows = await extractDomesticStockRows(sourceEnv, options);
  const transformed = transformDomesticStockRows(sourceRows, {
    warehouseCode: WAREHOUSE_CODE,
    sourceSystem: SOURCE_SYSTEM,
    etlRunId,
  });

  const result = {
    mode: options.apply ? "apply" : "dry-run",
    etl_run_id: etlRunId,
    ...transformed.summary,
    samples: {
      raw: transformed.rawRows.slice(0, 2),
      lot: transformed.lotRows.slice(0, 2),
      sku: transformed.skuRows.slice(0, 5),
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Re-run with --apply after applying scripts/etl/domestic/designkr-schema.sql to Supabase.");
    return;
  }

  const supabase = getSupabaseEnv({ requireServiceRole: true });
  const writeResult = await applyToSupabase(supabase, transformed.rawRows, transformed.lotRows, transformed.skuRows, {
    etlRunId,
    snapshotDate: transformed.summary.snapshot_date || null,
    summary: transformed.summary,
  });
  console.log(JSON.stringify({ status: "SUCCESS", ...writeResult }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { apply: false, schemaCheck: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--schema-check") options.schemaCheck = true;
    else if (arg === "--database") options.database = requireArg(args, ++i, "--database");
    else if (arg === "--date") options.date = requireArg(args, ++i, "--date");
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, "--limit"));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  }

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

function getEnv(name: string, legacyName?: string) {
  return process.env[name] || (legacyName ? process.env[legacyName] : undefined);
}

function requireEnv(name: string, legacyName?: string) {
  const value = getEnv(name, legacyName);
  if (!value) {
    throw new Error(`Missing required env var: ${name}${legacyName ? ` or ${legacyName}` : ""}`);
  }
  return value;
}

function getSourceEnv(options: CliOptions): SourceEnv {
  return {
    host: requireEnv("DOMESTIC_SOURCE_DB_HOST", "BOOSTERS_CREW_MYSQL_HOST"),
    port: Number(getEnv("DOMESTIC_SOURCE_DB_PORT", "BOOSTERS_CREW_MYSQL_PORT") ?? 3306),
    database: options.database || process.env.DOMESTIC_SOURCE_DB_DATABASE || "boosters",
    user: requireEnv("DOMESTIC_SOURCE_DB_USER", "BOOSTERS_CREW_MYSQL_USER"),
    password: requireEnv("DOMESTIC_SOURCE_DB_PASSWORD", "BOOSTERS_CREW_MYSQL_PASSWORD"),
  };
}

function getSupabaseEnv({ requireServiceRole = false }: { requireServiceRole?: boolean } = {}): SupabaseEnv {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (requireServiceRole && !serviceRole) {
    throw new Error("Missing required env var: SUPABASE_SERVICE_ROLE_KEY. Apply mode writes ETL marts and must not use the browser anon key.");
  }
  const apiKey = serviceRole || requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, apiKey };
}

async function connectSource(env: SourceEnv) {
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

async function runSchemaCheck(env: SourceEnv) {
  const conn = await connectSource(env);
  try {
    const requiredColumns = [
      "standard_date",
      "product_code",
      "product_name",
      "barcode",
      "lot",
      "expiration_date",
      "warehouse_lname",
      "location",
      "stock_quantity",
      "delivery_wait_quantity",
      "available_stock_quantity",
    ];

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = ?
        ORDER BY ordinal_position`,
      [env.database, SOURCE_TABLE],
    );

    const observed = new Set(rows.map((row) => String(row.column_name)));
    const missingColumns = requiredColumns.filter((column) => !observed.has(column));
    const [freshnessRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(standard_date), '%Y-%m-%d') AS latest_standard_date,
              COUNT(*) AS row_count
         FROM ${SOURCE_TABLE}`,
    );

    console.log(JSON.stringify({
      database: env.database,
      table: SOURCE_TABLE,
      exists: rows.length > 0,
      observedColumnCount: observed.size,
      missingColumns,
      latest_standard_date: freshnessRows[0]?.latest_standard_date ?? null,
      row_count: Number(freshnessRows[0]?.row_count ?? 0),
    }, null, 2));
  } finally {
    await conn.end();
  }
}

async function extractDomesticStockRows(env: SourceEnv, options: CliOptions) {
  const conn = await connectSource(env);
  try {
    const params: Array<string | number> = [];
    const datePredicate = options.date
      ? "standard_date = ?"
      : `standard_date = (SELECT MAX(standard_date) FROM ${SOURCE_TABLE})`;
    if (options.date) params.push(options.date);
    const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
          DATE_FORMAT(standard_date, '%Y-%m-%d') AS standard_date,
          product_code,
          product_name,
          barcode,
          lot,
          DATE_FORMAT(expiration_date, '%Y-%m-%d') AS expiration_date,
          warehouse_lname,
          location,
          stock_quantity,
          delivery_wait_quantity,
          available_stock_quantity
         FROM ${SOURCE_TABLE}
        WHERE ${datePredicate}
          AND stock_quantity > 0
        ORDER BY product_code, expiration_date, warehouse_lname, location
        ${limitClause}`,
      params,
    );

    return rows.map((row) => ({
      standard_date: row.standard_date,
      product_code: row.product_code,
      product_name: row.product_name,
      barcode: row.barcode,
      lot: row.lot,
      expiration_date: row.expiration_date,
      warehouse_lname: row.warehouse_lname,
      location: row.location,
      stock_quantity: row.stock_quantity,
      delivery_wait_quantity: row.delivery_wait_quantity,
      available_stock_quantity: row.available_stock_quantity,
    })) satisfies DomesticStockRawRow[];
  } finally {
    await conn.end();
  }
}

async function applyToSupabase(
  supabase: SupabaseEnv,
  rawRows: DomesticRawSnapshotUpsertRow[],
  lotRows: DomesticLotSnapshotUpsertRow[],
  skuRows: DomesticSkuSnapshotUpsertRow[],
  meta: { etlRunId: string; snapshotDate: string | null; summary: unknown },
) {
  const rawWritten = await upsertRows(supabase, "raw_domestic_stock_location_snapshots", "source_raw_key", rawRows);
  const lotWritten = await upsertRows(supabase, "mart_domestic_stock_lot_snapshot", "raw_key", lotRows);
  const skuWritten = await upsertRows(supabase, "mart_domestic_stock_sku_snapshot", "raw_key", skuRows);

  await upsertRows(supabase, "etl_run_logs", "etl_run_id", [
    {
      etl_run_id: meta.etlRunId,
      pipeline: "designkr_domestic_stock",
      status: "success",
      snapshot_date: meta.snapshotDate,
      finished_at: new Date().toISOString(),
      source_rows: rawRows.length,
      raw_rows: rawRows.length,
      mart_lot_rows: lotRows.length,
      mart_sku_rows: skuRows.length,
      summary: meta.summary,
      error_message: null,
    },
  ]);

  return { rawWritten, lotWritten, skuWritten };
}

async function upsertRows<T extends object>(
  supabase: SupabaseEnv,
  table: TableName,
  conflictKey: string,
  rows: T[],
) {
  let written = 0;
  for (let i = 0; i < rows.length; i += DEFAULT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + DEFAULT_BATCH_SIZE);
    const res = await fetch(`${supabase.url}/rest/v1/${table}?on_conflict=${conflictKey}`, {
      method: "POST",
      headers: {
        apikey: supabase.apiKey,
        authorization: `Bearer ${supabase.apiKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert failed for ${table} (${res.status}): ${body}`);
    }
    written += chunk.length;
  }
  return written;
}

function buildEtlRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `designkr-domestic-stock-${stamp}`;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "ERROR", message: error.message }, null, 2));
  process.exit(1);
});
