import * as mysql from "mysql2/promise";

import {
  buildAmzStockRawKey,
  resolveAmazonCenter,
  transformAmazonInventoryRows,
  type AmazonInventoryRawRow,
  type AmzStockUpsertRow,
} from "../../../src/lib/scm-dashboard/amazonStockEtl.ts";

type CliOptions = {
  apply: boolean;
  schemaCheck: boolean;
  date: string;
  limit?: number;
  skipParity: boolean;
  asOf?: string;
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

type TableName =
  | "raw_amazon_inventory_snapshots"
  | "mart_amazon_inventory_snapshot"
  | "etl_run_logs";

type CenterSummary = Record<string, {
  rows: number;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_incoming: number;
  customer_order: number;
}>;

const DEFAULT_CREW_DB = "boosters";
const DEFAULT_BATCH_SIZE = 500;
const PIPELINE = "amazon_inventory_snapshot";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const crewEnv = getCrewEnv();

  if (options.schemaCheck) {
    await runSchemaCheck(crewEnv);
    return;
  }

  const etlRunId = buildEtlRunId();
  const rawRows = await extractAmazonInventoryRows(crewEnv, options);
  const payload = transformAmazonInventoryRows(rawRows, options.date);
  const newSummary = summarizePayload(payload);
  const supabase = getSupabaseEnv({ requireServiceRole: options.apply });
  const legacySummary = options.skipParity ? null : await fetchLegacySummary(supabase, options.date);
  const parity = legacySummary ? compareSummaries(newSummary.byCenter, legacySummary.byCenter) : [];

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    etl_run_id: etlRunId,
    date: options.date,
    as_of: options.asOf ?? null,
    sourceRows: rawRows.length,
    transformedRows: payload.length,
    new_mart: newSummary,
    legacy_amz_stock: legacySummary,
    parity,
    samples: {
      raw: rawRows.slice(0, 3),
      mart: payload.slice(0, 3),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Re-run with --apply after applying scripts/etl/amazon/amazon-inventory-schema.sql to Supabase.");
    return;
  }

  const writeResult = await applyToSupabase(supabase, rawRows, payload, {
    etlRunId,
    snapshotDate: options.date,
    summary: { new_mart: newSummary, legacy_amz_stock: legacySummary, parity },
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

  const options: CliOptions = { apply: false, schemaCheck: false, date: today, skipParity: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--schema-check") options.schemaCheck = true;
    else if (arg === "--skip-parity") options.skipParity = true;
    else if (arg === "--as-of") options.asOf = requireArg(args, ++i, "--as-of");
    else if (arg === "--date") options.date = requireArg(args, ++i, "--date");
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, "--limit"));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  }

  if (options.asOf && Number.isNaN(new Date(options.asOf).getTime())) {
    throw new Error(`--as-of must be an ISO-compatible timestamp, got ${options.asOf}`);
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
  const apiKey = serviceRole || requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, apiKey };
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
      [
        "amazon_fba_inventorys",
        [
          "id",
          "marketplaceid",
          "asin",
          "seller_sku",
          "fn_sku",
          "total_quantity",
          "fulfillable_quantity",
          "pending_transshipment_quantity",
          "inbound_shipped_quantity",
          "inbound_receiving_quantity",
          "inbound_working_quantity",
          "pending_customer_order_quantity",
          "fc_processing_quantity",
          "updated_at",
        ],
      ],
      ["boosters_item_groups", ["resource_code", "resource_name", "amazon_seller_asin"]],
    ]);

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name IN ('amazon_fba_inventorys', 'boosters_item_groups')
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

    const report = Array.from(requiredColumns, ([table, columns]) => ({
      table,
      exists: actual.has(table),
      missingColumns: columns.filter((column) => !actual.get(table)?.has(column)),
      observedColumnCount: actual.get(table)?.size ?? 0,
    }));

    console.log(JSON.stringify({ database: env.database, schemaCheck: report }, null, 2));
  } finally {
    await conn.end();
  }
}

async function extractAmazonInventoryRows(env: CrewEnv, options: CliOptions) {
  const conn = await connectCrew(env);
  try {
    const limitClause = options.limit ? `LIMIT ${options.limit}` : "";
    const asOf = options.asOf ?? new Date().toISOString().slice(0, 19).replace("T", " ");
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
          MAX(p.id) AS source_max_id,
          COUNT(*) AS source_row_count,
          MAX(p.updated_at) AS latest_updated_at,
          p.marketplaceid,
          CASE p.marketplaceid
            WHEN 'ATVPDKIKX0DER' THEN 'US'
            WHEN 'A1PA6795UKMFR9' THEN 'DE'
            WHEN 'A1F83G8C2ARO7P' THEN 'UK'
            WHEN 'A2VIGQ35RCS4UG' THEN 'AE'
            ELSE 'OTHER'
          END AS country,
          m.resource_code,
          SUM(COALESCE(p.fulfillable_quantity, 0)) AS fulfillable_quantity,
          SUM(COALESCE(p.pending_transshipment_quantity, 0)) AS pending_transshipment_quantity,
          SUM(COALESCE(p.inbound_shipped_quantity, 0)) AS inbound_shipped_quantity,
          SUM(COALESCE(p.inbound_receiving_quantity, 0)) AS inbound_receiving_quantity,
          SUM(COALESCE(p.inbound_working_quantity, 0)) AS inbound_working_quantity,
          SUM(COALESCE(p.pending_customer_order_quantity, 0)) AS pending_customer_order_quantity,
          SUM(COALESCE(p.fc_processing_quantity, 0)) AS fc_processing_quantity,
          GROUP_CONCAT(DISTINCT p.asin ORDER BY p.asin SEPARATOR ',') AS asin_list
         FROM amazon_fba_inventorys p
         JOIN (
           SELECT
             x.marketplaceid,
             x.asin,
             COALESCE(
               MAX(CASE WHEN x.marketplaceid = 'A2VIGQ35RCS4UG' AND x.seller_sku LIKE '%-AE' THEN x.id END),
               MAX(CASE WHEN x.fn_sku = x.asin THEN x.id END),
               MAX(x.id)
             ) AS pick_id
           FROM amazon_fba_inventorys x
           WHERE x.updated_at <= NOW()
             AND x.fn_sku <> 'X004B9WFEL'
             AND x.marketplaceid IN (
               'ATVPDKIKX0DER',
               'A1PA6795UKMFR9',
               'A1F83G8C2ARO7P',
               'A2VIGQ35RCS4UG'
             )
           GROUP BY x.marketplaceid, x.asin
         ) pick
           ON p.id = pick.pick_id
         JOIN (
           SELECT asin, MIN(resource_code) AS resource_code
           FROM (
             SELECT amazon_seller_asin AS asin, resource_code
             FROM boosters_item_groups
             WHERE resource_code LIKE 'BA0%'
           ) mapped
           GROUP BY asin
         ) m
           ON p.asin = m.asin
        WHERE p.marketplaceid IN (
          'ATVPDKIKX0DER',
          'A1PA6795UKMFR9',
          'A1F83G8C2ARO7P',
          'A2VIGQ35RCS4UG'
        )
        GROUP BY p.marketplaceid, country, m.resource_code
        HAVING
          SUM(COALESCE(p.total_quantity, 0)) > 3
          OR SUM(COALESCE(p.inbound_working_quantity, 0)) > 0
          OR SUM(COALESCE(p.inbound_shipped_quantity, 0)) > 0
          OR SUM(COALESCE(p.inbound_receiving_quantity, 0)) > 0
        ORDER BY latest_updated_at DESC, country, SUM(COALESCE(p.total_quantity, 0)) DESC
        ${limitClause}`,
      [asOf],
    );

    return rows.map((row) => ({
      marketplaceid: row.marketplaceid,
      country: row.country,
      resource_code: row.resource_code,
      source_row_count: row.source_row_count,
      source_max_id: row.source_max_id,
      fulfillable_quantity: row.fulfillable_quantity,
      pending_transshipment_quantity: row.pending_transshipment_quantity,
      inbound_shipped_quantity: row.inbound_shipped_quantity,
      inbound_receiving_quantity: row.inbound_receiving_quantity,
      inbound_working_quantity: row.inbound_working_quantity,
      pending_customer_order_quantity: row.pending_customer_order_quantity,
      fc_processing_quantity: row.fc_processing_quantity,
      asin_list: row.asin_list,
      latest_updated_at: row.latest_updated_at,
    })) satisfies AmazonInventoryRawRow[];
  } finally {
    await conn.end();
  }
}

function summarizePayload(payload: AmzStockUpsertRow[]) {
  const byCenter = payload.reduce<CenterSummary>((acc, row) => {
    acc[row.center] ??= {
      rows: 0,
      stock_sellable: 0,
      stock_available: 0,
      pending_fc: 0,
      stock_incoming: 0,
      customer_order: 0,
    };
    acc[row.center].rows += 1;
    acc[row.center].stock_sellable += row.stock_sellable;
    acc[row.center].stock_available += row.stock_available;
    acc[row.center].pending_fc += row.pending_fc;
    acc[row.center].stock_incoming += row.stock_expected + row.stock_processing + row.stock_readytoship;
    acc[row.center].customer_order += row.customer_order;
    return acc;
  }, {});

  return { byCenter };
}

async function fetchLegacySummary(supabase: SupabaseEnv, date: string) {
  const endpoint = `${supabase.url}/rest/v1/amz_stock?date=eq.${encodeURIComponent(date)}&select=center,stock_sellable,stock_available,pending_fc,stock_expected,stock_processing,stock_readytoship,customer_order&limit=10000`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: supabase.apiKey,
      authorization: `Bearer ${supabase.apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Legacy amz_stock fetch failed (${res.status}): ${body}`);
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const byCenter = rows.reduce<CenterSummary>((acc, row) => {
    const center = String(row.center ?? "UNKNOWN");
    acc[center] ??= {
      rows: 0,
      stock_sellable: 0,
      stock_available: 0,
      pending_fc: 0,
      stock_incoming: 0,
      customer_order: 0,
    };
    acc[center].rows += 1;
    acc[center].stock_sellable += num(row.stock_sellable);
    acc[center].stock_available += num(row.stock_available);
    acc[center].pending_fc += num(row.pending_fc);
    acc[center].stock_incoming += num(row.stock_expected) + num(row.stock_processing) + num(row.stock_readytoship);
    acc[center].customer_order += num(row.customer_order);
    return acc;
  }, {});

  return { rows: rows.length, byCenter };
}

function compareSummaries(newSummary: CenterSummary, legacySummary: CenterSummary) {
  const centers = Array.from(new Set([...Object.keys(newSummary), ...Object.keys(legacySummary)])).sort();
  const diffs: Array<Record<string, unknown>> = [];
  for (const center of centers) {
    const current = newSummary[center] ?? emptyCenter();
    const legacy = legacySummary[center] ?? emptyCenter();
    const fields = ["rows", "stock_sellable", "stock_available", "pending_fc", "stock_incoming", "customer_order"] as const;
    const delta = Object.fromEntries(fields.map((field) => [field, current[field] - legacy[field]]));
    if (Object.values(delta).some((value) => value !== 0)) {
      diffs.push({ center, delta, new: current, legacy });
    }
  }
  return diffs;
}

function emptyCenter() {
  return { rows: 0, stock_sellable: 0, stock_available: 0, pending_fc: 0, stock_incoming: 0, customer_order: 0 };
}

async function applyToSupabase(
  supabase: SupabaseEnv,
  rawRows: AmazonInventoryRawRow[],
  payload: AmzStockUpsertRow[],
  meta: { etlRunId: string; snapshotDate: string; summary: unknown },
) {
  const rawWritten = await upsertRows(
    supabase,
    "raw_amazon_inventory_snapshots",
    "raw_key",
    rawRows.map((row) => toRawSnapshotRow(row, meta)),
  );
  const martWritten = await upsertRows(
    supabase,
    "mart_amazon_inventory_snapshot",
    "raw_key",
    payload.map((row) => toMartSnapshotRow(row, meta)),
  );

  await upsertRows(supabase, "etl_run_logs", "etl_run_id", [
    {
      etl_run_id: meta.etlRunId,
      pipeline: PIPELINE,
      status: "success",
      snapshot_date: meta.snapshotDate,
      finished_at: new Date().toISOString(),
      source_rows: rawRows.length,
      raw_rows: rawRows.length,
      mart_lot_rows: null,
      mart_sku_rows: payload.length,
      summary: meta.summary,
      error_message: null,
    },
  ]);

  return { rawWritten, martWritten };
}

function toRawSnapshotRow(row: AmazonInventoryRawRow, meta: { etlRunId: string; snapshotDate: string }) {
  const center = resolveAmazonCenter(row.marketplaceid, row.country);
  const resourceCode = String(row.resource_code ?? "").trim();
  return {
    raw_key: buildAmzStockRawKey({ resource_code: resourceCode, center: center ?? "", date: meta.snapshotDate }),
    snapshot_date: meta.snapshotDate,
    source_system: "boosters_crew.amazon_fba_inventorys",
    marketplaceid: row.marketplaceid,
    center,
    asin: null,
    asin_list: row.asin_list,
    resource_code: resourceCode,
    fulfillable_quantity: num(row.fulfillable_quantity),
    pending_transshipment_quantity: num(row.pending_transshipment_quantity),
    inbound_shipped_quantity: num(row.inbound_shipped_quantity),
    inbound_receiving_quantity: num(row.inbound_receiving_quantity),
    inbound_working_quantity: num(row.inbound_working_quantity),
    pending_customer_order_quantity: num(row.pending_customer_order_quantity),
    fc_processing_quantity: num(row.fc_processing_quantity),
    source_row_count: num(row.source_row_count) || 1,
    source_max_id: row.source_max_id ? num(row.source_max_id) : null,
    latest_updated_at: row.latest_updated_at ? new Date(row.latest_updated_at).toISOString() : null,
    etl_run_id: meta.etlRunId,
    updated_at: new Date().toISOString(),
  };
}

function toMartSnapshotRow(row: AmzStockUpsertRow, meta: { etlRunId: string }) {
  return {
    raw_key: row.raw_key,
    snapshot_date: row.date,
    center: row.center,
    resource_code: row.resource_code,
    stock_sellable: row.stock_sellable,
    stock_available: row.stock_available,
    pending_fc: row.pending_fc,
    stock_expected: row.stock_expected,
    stock_processing: row.stock_processing,
    stock_readytoship: row.stock_readytoship,
    customer_order: row.customer_order,
    fc_processing: row.fc_processing,
    source_row_count: row.source_row_count ?? 1,
    source_max_id: row.source_max_id ?? null,
    latest_updated_at: row.latest_updated_at,
    etl_run_id: meta.etlRunId,
    updated_at: new Date().toISOString(),
  };
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

function num(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildEtlRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${PIPELINE}-${stamp}`;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "ERROR", message: error.message }, null, 2));
  process.exit(1);
});
