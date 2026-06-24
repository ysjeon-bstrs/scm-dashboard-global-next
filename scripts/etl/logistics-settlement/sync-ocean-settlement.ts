import * as mysql from "mysql2/promise";

import { allocateOceanSettlement } from "../../../src/lib/scm-dashboard/logisticsSettlement/oceanAllocation.ts";
import {
  buildMonthlyRows,
  buildOceanEtlRunLogRow,
  OCEAN_PIPELINE,
  summarizeAllocation,
  toMartDocRow,
  type MartDocRow,
  type MonthlySkuRow,
} from "../../../src/lib/scm-dashboard/logisticsSettlement/oceanMart.ts";
import {
  getSupabaseRestEnv,
  supabaseGetAll,
  supabaseUpsertRows,
} from "../../../src/lib/scm-dashboard/logisticsSettlement/supabaseRest.ts";
import type {
  GlobalMoveLine,
  OceanSettlementLine,
  SkuMaster,
  UnitPrice,
} from "../../../src/lib/scm-dashboard/logisticsSettlement/types.ts";

type CliOptions = {
  apply: boolean;
  schemaCheck: boolean;
  limit?: number;
  month?: string;
};

type SourceDbEnv = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

type OceanSettlementSupabaseRow = {
  raw_key: string;
  invoice_date: string | null;
  bl_no: string;
  country: string;
  charge_type: string;
  currency: string;
  amount_orig: number | string | null;
  exrate: number | string | null;
  amount_krw: number | string | null;
  tax_krw: number | string | null;
  container_type: string | null;
  file_name: string | null;
  file_id: string | null;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDb = getSourceDbEnv();

  if (options.schemaCheck) {
    await runSchemaCheck(sourceDb);
    return;
  }

  const etlRunId = buildEtlRunId();
  const moves = await fetchOceanMoveLines(sourceDb, options);
  const supabase = getSupabaseRestEnv({ requireServiceRole: options.apply });
  const [settlement, skuMasters, unitPrices] = await Promise.all([
    fetchOceanSettlementRows(supabase, options),
    fetchSkuMasters(sourceDb),
    fetchUnitPrices(sourceDb),
  ]);

  const allocation = allocateOceanSettlement({ moves, settlement, skuMasters, unitPrices });
  const martRows = allocation.rows.map((row) => toMartDocRow(row, etlRunId));
  const monthlyRows = buildMonthlyRows(allocation.rows, etlRunId);

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    etl_run_id: etlRunId,
    month: options.month ?? null,
    sourceRows: moves.length,
    settlementRows: settlement.length,
    skuMasterRows: skuMasters.length,
    unitPriceRows: unitPrices.length,
    allocatedRows: allocation.rows.length,
    monthlyRows: monthlyRows.length,
    warningCount: allocation.warnings.length,
    warningSamples: allocation.warnings.slice(0, 20),
    totals: summarizeAllocation(allocation.rows),
    samples: {
      allocations: allocation.rows.slice(0, 3),
      monthly: monthlyRows.slice(0, 3),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Apply scripts/etl/logistics-settlement/logistics-settlement-schema.sql and re-run with --apply to write Supabase marts.");
    return;
  }

  const writeResult = await applyToSupabase(supabase, martRows, monthlyRows, {
    etlRunId,
    report,
    movementRowCount: moves.length,
    settlementRowCount: settlement.length,
  });
  console.log(JSON.stringify({ status: "SUCCESS", ...writeResult }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { apply: false, schemaCheck: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--schema-check") options.schemaCheck = true;
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, "--limit"));
    else if (arg === "--month") options.month = requireArg(args, ++i, "--month");
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number");
  }
  if (options.month && !/^\d{4}-\d{2}$/.test(options.month)) {
    throw new Error("--month must use YYYY-MM format");
  }

  return options;
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function getSourceDbEnv(): SourceDbEnv {
  return {
    host: requireEnv("SCM_SOURCE_DB_HOST", "BOOSTERS_SCM_MYSQL_HOST"),
    port: Number(process.env.SCM_SOURCE_DB_PORT || process.env.BOOSTERS_SCM_MYSQL_PORT || 3306),
    database: requireEnv("SCM_SOURCE_DB_DATABASE", "BOOSTERS_SCM_MYSQL_DATABASE"),
    user: requireEnv("SCM_SOURCE_DB_USER", "BOOSTERS_SCM_MYSQL_USER"),
    password: requireEnv("SCM_SOURCE_DB_PASSWORD", "BOOSTERS_SCM_MYSQL_PASSWORD"),
  };
}

function requireEnv(name: string, legacyName?: string) {
  const value = process.env[name] || (legacyName ? process.env[legacyName] : undefined);
  if (!value) throw new Error(`Missing required env var: ${name}${legacyName ? ` or ${legacyName}` : ""}`);
  return value;
}

async function createSourceConnection(env: SourceDbEnv) {
  return mysql.createConnection({
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    timezone: "+00:00",
  });
}

async function runSchemaCheck(env: SourceDbEnv) {
  const conn = await createSourceConnection(env);
  try {
    const [columns] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'scm_global_move_shipments'
      ORDER BY ORDINAL_POSITION
    `);
    const [modeRows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT carrier_mode, carrier_name, COUNT(*) AS rows_cnt, SUM(qty_ea) AS qty_ea
      FROM scm_global_move_shipments
      GROUP BY carrier_mode, carrier_name
      ORDER BY rows_cnt DESC
    `);
    const [oceanRows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT COUNT(*) AS ocean_rows,
             COUNT(DISTINCT invoice_no) AS ocean_invoices,
             COUNT(DISTINCT bl_no) AS ocean_bls,
             SUM(qty_ea) AS ocean_qty_ea
      FROM scm_global_move_shipments
      WHERE carrier_mode = '해상'
        AND invoice_no <> ''
    `);
    console.log(JSON.stringify({
      database: env.database,
      columns,
      modes: modeRows,
      ocean: oceanRows[0],
    }, null, 2));
  } finally {
    await conn.end();
  }
}

async function fetchOceanMoveLines(env: SourceDbEnv, options: CliOptions): Promise<GlobalMoveLine[]> {
  const conn = await createSourceConnection(env);
  try {
    const limitSql = options.limit ? " LIMIT ?" : "";
    const params = options.limit ? [options.limit] : [];
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT
        id AS sourceLineId,
        invoice_no AS invoiceNo,
        carrier_name AS carrier,
        carrier_mode AS carrierMode,
        DATE_FORMAT(onboard_date, '%Y-%m-%d') AS shipDate,
        from_warehouse AS fromWarehouse,
        to_warehouse AS toWarehouse,
        resource_code AS resourceCode,
        resource_name AS resourceName,
        qty_ea AS qtyEa,
        qty_ctn AS qtyCtn,
        unit_price AS unitPriceUsd,
        amount_usd AS amountUsd,
        bl_no AS blNo
      FROM scm_global_move_shipments
      WHERE invoice_no <> ''
        AND carrier_mode = '해상'
      ORDER BY COALESCE(onboard_date, created_at), id
      ${limitSql}
    `, params);

    return rows.map((row) => ({
      sourceLineId: Number(row.sourceLineId),
      invoiceNo: String(row.invoiceNo ?? ""),
      carrier: String(row.carrier ?? ""),
      carrierMode: String(row.carrierMode ?? ""),
      shipDate: row.shipDate ? String(row.shipDate) : null,
      fromWarehouse: String(row.fromWarehouse ?? ""),
      toWarehouse: String(row.toWarehouse ?? ""),
      resourceCode: String(row.resourceCode ?? ""),
      resourceName: String(row.resourceName ?? ""),
      qtyEa: Number(row.qtyEa ?? 0),
      qtyCtn: Number(row.qtyCtn ?? 0),
      unitPriceUsd: Number(row.unitPriceUsd ?? 0),
      amountUsd: Number(row.amountUsd ?? 0),
      blNo: String(row.blNo ?? ""),
    }));
  } finally {
    await conn.end();
  }
}

async function fetchOceanSettlementRows(env: { url: string; apiKey: string }, options: CliOptions): Promise<OceanSettlementLine[]> {
  const params = new URLSearchParams({
    select: "raw_key,invoice_date,bl_no,country,charge_type,currency,amount_orig,exrate,amount_krw,tax_krw,container_type,file_name,file_id",
    order: "bl_no.asc,invoice_date.asc,raw_key.asc",
  });
  if (options.month) {
    params.set("invoice_date", `gte.${options.month}-01`);
  }
  const rows = await supabaseGetAll<OceanSettlementSupabaseRow>(env, "stg_settlement_ocean_lines", params);
  return rows
    .filter((row) => !options.month || String(row.invoice_date ?? "").startsWith(options.month!))
    .map((row) => ({
      rawKey: row.raw_key,
      invoiceDate: row.invoice_date,
      blNo: row.bl_no,
      country: row.country,
      chargeType: row.charge_type,
      currency: row.currency,
      amountOrig: numberValue(row.amount_orig),
      exrate: numberValue(row.exrate),
      amountKrw: numberValue(row.amount_krw),
      taxKrw: numberValue(row.tax_krw),
      containerType: row.container_type ?? "",
      fileName: row.file_name ?? "",
      fileId: row.file_id ?? "",
    }));
}

async function fetchSkuMasters(env: SourceDbEnv): Promise<SkuMaster[]> {
  const conn = await createSourceConnection(env);
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT product_code AS resourceCode,
             sku_weight AS skuWeightG
      FROM scm_global_move_master_item
      WHERE product_code <> ''
      ORDER BY product_code
    `);
    return rows.map((row) => ({
      resourceCode: String(row.resourceCode ?? ""),
      skuWeightG: numberValue(row.skuWeightG),
    }));
  } finally {
    await conn.end();
  }
}

async function fetchUnitPrices(env: SourceDbEnv): Promise<UnitPrice[]> {
  const conn = await createSourceConnection(env);
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT from_country AS fromCountry,
             to_country AS toCountry,
             product_code AS resourceCode,
             proposed_price AS proposalUnitPriceUsd
      FROM scm_global_move_master_unit_price
      WHERE product_code <> ''
      ORDER BY product_code, from_country, to_country
    `);
    return rows.map((row) => ({
      fromCountry: String(row.fromCountry ?? ""),
      toCountry: String(row.toCountry ?? ""),
      resourceCode: String(row.resourceCode ?? ""),
      proposalUnitPriceUsd: moneyValue(row.proposalUnitPriceUsd),
    }));
  } finally {
    await conn.end();
  }
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  return numberValue(cleaned);
}

async function applyToSupabase(
  env: { url: string; apiKey: string },
  martRows: MartDocRow[],
  monthlyRows: MonthlySkuRow[],
  context: { etlRunId: string; report: unknown; movementRowCount: number; settlementRowCount: number },
) {
  const mart = await supabaseUpsertRows(env, "mart_logistics_doc_analysis", "raw_key", martRows);
  const monthly = await supabaseUpsertRows(env, "mart_logistics_monthly_sku_cost", "raw_key", monthlyRows);
  const log = await supabaseUpsertRows(env, "etl_run_logs", "etl_run_id", [
    buildOceanEtlRunLogRow({
      etlRunId: context.etlRunId,
      movementRowCount: context.movementRowCount,
      settlementRowCount: context.settlementRowCount,
      martRowCount: martRows.length,
      monthlyRowCount: monthlyRows.length,
      summary: context.report,
    }),
  ]);
  return { mart, monthly, log };
}

function buildEtlRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${OCEAN_PIPELINE}_${stamp}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
