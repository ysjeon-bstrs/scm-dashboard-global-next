import { allocateOceanSettlement } from "./oceanAllocation";
import {
  buildMonthlyRows,
  buildOceanEtlRunLogRow,
  planOceanCleanup,
  summarizeAllocation,
  toMartDocRow,
  type OceanCleanupPlan,
} from "./oceanMart";
import {
  getSupabaseRestEnv,
  supabaseCount,
  supabaseDelete,
  supabaseGetAll,
  supabaseUpsertRows,
} from "./supabaseRest";
import type { GlobalMoveLine, OceanSettlementLine, SkuMaster, UnitPrice } from "./types";
import { queryBoostersScmReadOnly } from "../mysqlPools";

export type OceanRecomputeOptions = {
  apply?: boolean;
  month?: string;
  limit?: number;
  etlRunId: string;
};

export type OceanRecomputeSummary = {
  mode: "dry-run" | "apply";
  etlRunId: string;
  month: string | null;
  movementRowCount: number;
  settlementRowCount: number;
  skuMasterRows: number;
  unitPriceRows: number;
  allocationRowCount: number;
  monthlyRowCount: number;
  warningCount: number;
  affectedBlCount: number;
  affectedSkuCount: number;
  totals: {
    logisticsKrw: number;
    freightKrw: number;
    dutyKrw: number;
    otherKrw: number;
  };
  warningSamples: unknown[];
  // Stale-row cleanup: in dry-run the counts are rows that WOULD be replaced;
  // in apply they are rows actually deleted. Skipped (eligible=false) for partial runs.
  cleanup: {
    eligible: boolean;
    reason: string | null;
    scope: "month" | "all";
    month: string | null;
    martRowsAffected: number;
    monthlyRowsAffected: number;
  };
  written?: {
    mart: { written: number };
    monthly: { written: number };
    log: { written: number };
  };
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

export async function runOceanRecompute(options: OceanRecomputeOptions): Promise<OceanRecomputeSummary> {
  // Ocean settlement reads always require the service role (see commit aab1fe1); the
  // apply flag only gates the mart writes below, not the staging read credential.
  const supabase = getSupabaseRestEnv({ requireServiceRole: true });
  const [moves, settlement, skuMasters, unitPrices] = await Promise.all([
    fetchOceanMoveLines(options),
    fetchOceanSettlementRows(supabase, options),
    fetchSkuMasters(),
    fetchUnitPrices(),
  ]);

  const allocation = allocateOceanSettlement({ moves, settlement, skuMasters, unitPrices });
  const martRows = allocation.rows.map((row) => toMartDocRow(row, options.etlRunId));
  const monthlyRows = buildMonthlyRows(allocation.rows, options.etlRunId);
  const bls = new Set(allocation.rows.map((row) => row.blNo).filter(Boolean));
  const skus = new Set(allocation.rows.map((row) => row.resourceCode).filter(Boolean));
  const cleanupPlan = planOceanCleanup(options);
  const summary: OceanRecomputeSummary = {
    mode: options.apply ? "apply" : "dry-run",
    etlRunId: options.etlRunId,
    month: options.month ?? null,
    movementRowCount: moves.length,
    settlementRowCount: settlement.length,
    skuMasterRows: skuMasters.length,
    unitPriceRows: unitPrices.length,
    allocationRowCount: allocation.rows.length,
    monthlyRowCount: monthlyRows.length,
    warningCount: allocation.warnings.length,
    affectedBlCount: bls.size,
    affectedSkuCount: skus.size,
    totals: summarizeAllocation(allocation.rows),
    warningSamples: allocation.warnings.slice(0, 20),
    cleanup: {
      eligible: cleanupPlan.eligible,
      reason: cleanupPlan.reason,
      scope: cleanupPlan.scope,
      month: cleanupPlan.month,
      martRowsAffected: 0,
      monthlyRowsAffected: 0,
    },
  };

  if (!options.apply) {
    if (cleanupPlan.eligible) {
      // Preview how many stale ocean_v1 rows the apply would replace in the target scope.
      const [martRowsAffected, monthlyRowsAffected] = await Promise.all([
        supabaseCount(supabase, "mart_logistics_doc_analysis", cleanupFilters("settlement_month", cleanupPlan)),
        supabaseCount(supabase, "mart_logistics_monthly_sku_cost", cleanupFilters("month", cleanupPlan)),
      ]);
      summary.cleanup.martRowsAffected = martRowsAffected;
      summary.cleanup.monthlyRowsAffected = monthlyRowsAffected;
    }
    return summary;
  }

  const mart = await supabaseUpsertRows(supabase, "mart_logistics_doc_analysis", "raw_key", martRows);
  const monthly = await supabaseUpsertRows(supabase, "mart_logistics_monthly_sku_cost", "raw_key", monthlyRows);
  const log = await supabaseUpsertRows(supabase, "etl_run_logs", "etl_run_id", [
    buildOceanEtlRunLogRow({
      etlRunId: options.etlRunId,
      movementRowCount: moves.length,
      settlementRowCount: settlement.length,
      martRowCount: martRows.length,
      monthlyRowCount: monthlyRows.length,
      summary,
    }),
  ]);

  if (cleanupPlan.eligible) {
    // Delete-after-upsert: remove stale rows in the target scope EXCEPT the ones this run
    // just wrote (etl_run_id != current), so the current data is never at risk.
    const [martDeleted, monthlyDeleted] = await Promise.all([
      supabaseDelete(supabase, "mart_logistics_doc_analysis", cleanupFilters("settlement_month", cleanupPlan, options.etlRunId)),
      supabaseDelete(supabase, "mart_logistics_monthly_sku_cost", cleanupFilters("month", cleanupPlan, options.etlRunId)),
    ]);
    summary.cleanup.martRowsAffected = martDeleted.deleted;
    summary.cleanup.monthlyRowsAffected = monthlyDeleted.deleted;
  }

  return { ...summary, written: { mart, monthly, log } };
}

function cleanupFilters(monthColumn: string, plan: OceanCleanupPlan, excludeEtlRunId?: string) {
  const params = new URLSearchParams({ allocation_rule_version: "eq.ocean_v1" });
  if (plan.scope === "month" && plan.month) params.set(monthColumn, `eq.${plan.month}`);
  if (excludeEtlRunId) params.set("etl_run_id", `neq.${excludeEtlRunId}`);
  return params;
}

async function fetchOceanMoveLines(options: OceanRecomputeOptions): Promise<GlobalMoveLine[]> {
  const limitSql = options.limit ? " LIMIT :limit" : "";
  const monthSql = options.month ? " AND DATE_FORMAT(onboard_date, '%Y-%m') = :month" : "";
  const rows = await queryBoostersScmReadOnly<Record<string, unknown>>(`
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
      ${monthSql}
    ORDER BY COALESCE(onboard_date, created_at), id
    ${limitSql}
  `, { month: options.month ?? null, limit: options.limit ?? null });

  return rows.map((row) => ({
    sourceLineId: numberValue(row.sourceLineId),
    invoiceNo: stringValue(row.invoiceNo),
    carrier: stringValue(row.carrier),
    carrierMode: stringValue(row.carrierMode),
    shipDate: row.shipDate ? stringValue(row.shipDate) : null,
    fromWarehouse: stringValue(row.fromWarehouse),
    toWarehouse: stringValue(row.toWarehouse),
    resourceCode: stringValue(row.resourceCode),
    resourceName: stringValue(row.resourceName),
    qtyEa: numberValue(row.qtyEa),
    qtyCtn: numberValue(row.qtyCtn),
    unitPriceUsd: numberValue(row.unitPriceUsd),
    amountUsd: numberValue(row.amountUsd),
    blNo: stringValue(row.blNo),
  }));
}

async function fetchOceanSettlementRows(env: { url: string; apiKey: string }, options: OceanRecomputeOptions): Promise<OceanSettlementLine[]> {
  const params = new URLSearchParams({
    select: "raw_key,invoice_date,bl_no,country,charge_type,currency,amount_orig,exrate,amount_krw,tax_krw,container_type,file_name,file_id",
    order: "bl_no.asc,invoice_date.asc,raw_key.asc",
  });
  if (options.month) {
    // Bound the month server-side (gte month-01 AND lt next-month-01) instead of an
    // open-ended gte that pulls every later month across the network.
    params.set("and", `(invoice_date.gte.${options.month}-01,invoice_date.lt.${firstDayOfNextMonth(options.month)})`);
  }
  const rows = await supabaseGetAll<OceanSettlementSupabaseRow>(env, "stg_settlement_ocean_lines", params);
  return rows
    .filter((row) => !options.month || String(row.invoice_date ?? "").startsWith(options.month))
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

async function fetchSkuMasters(): Promise<SkuMaster[]> {
  const rows = await queryBoostersScmReadOnly<Record<string, unknown>>(`
    SELECT product_code AS resourceCode,
           sku_weight AS skuWeightG
    FROM scm_global_move_master_item
    WHERE product_code <> ''
    ORDER BY product_code
  `);
  return rows.map((row) => ({ resourceCode: stringValue(row.resourceCode), skuWeightG: numberValue(row.skuWeightG) }));
}

async function fetchUnitPrices(): Promise<UnitPrice[]> {
  const rows = await queryBoostersScmReadOnly<Record<string, unknown>>(`
    SELECT from_country AS fromCountry,
           to_country AS toCountry,
           product_code AS resourceCode,
           proposed_price AS proposalUnitPriceUsd
    FROM scm_global_move_master_unit_price
    WHERE product_code <> ''
    ORDER BY product_code, from_country, to_country
  `);
  return rows.map((row) => ({
    fromCountry: stringValue(row.fromCountry),
    toCountry: stringValue(row.toCountry),
    resourceCode: stringValue(row.resourceCode),
    proposalUnitPriceUsd: moneyValue(row.proposalUnitPriceUsd),
  }));
}

function firstDayOfNextMonth(month: string) {
  const [year, monthNo] = month.split("-").map((part) => Number(part));
  const nextYear = monthNo >= 12 ? year + 1 : year;
  const nextMonth = monthNo >= 12 ? 1 : monthNo + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  return numberValue(cleaned);
}
