import { allocateOceanSettlement } from "./oceanAllocation";
import { getSupabaseRestEnv, supabaseGetAll, supabaseUpsertRows } from "./supabaseRest";
import type { GlobalMoveLine, OceanAllocationRow, OceanSettlementLine, SkuMaster, UnitPrice } from "./types";
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

type MartDocRow = Record<string, string | number | null>;
type MonthlySkuRow = Record<string, string | number | null>;

const PIPELINE = "logistics_settlement_ocean_v1";

export async function runOceanRecompute(options: OceanRecomputeOptions): Promise<OceanRecomputeSummary> {
  const supabase = getSupabaseRestEnv({ requireServiceRole: options.apply });
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
  };

  if (!options.apply) return summary;

  const mart = await supabaseUpsertRows(supabase, "mart_logistics_doc_analysis", "raw_key", martRows);
  const monthly = await supabaseUpsertRows(supabase, "mart_logistics_monthly_sku_cost", "raw_key", monthlyRows);
  const log = await supabaseUpsertRows(supabase, "etl_run_logs", "etl_run_id", [
    {
      etl_run_id: options.etlRunId,
      pipeline: PIPELINE,
      status: "SUCCESS",
      snapshot_date: null,
      finished_at: new Date().toISOString(),
      source_rows: moves.length,
      raw_rows: settlement.length,
      mart_lot_rows: martRows.length,
      mart_sku_rows: monthlyRows.length,
      summary,
      error_message: null,
    },
  ]);

  return { ...summary, written: { mart, monthly, log } };
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
  if (options.month) params.set("invoice_date", `gte.${options.month}-01`);
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

function toMartDocRow(row: OceanAllocationRow, etlRunId: string): MartDocRow {
  return {
    raw_key: row.rawKey,
    source_line_id: row.sourceLineId,
    invoice_no: row.invoiceNo,
    bl_no: row.blNo,
    carrier: row.carrier,
    carrier_mode: row.carrierMode,
    ship_date: row.shipDate,
    settlement_month: row.settlementMonth,
    from_warehouse: row.fromWarehouse,
    to_warehouse: row.toWarehouse,
    resource_code: row.resourceCode,
    resource_name: row.resourceName,
    qty_ea: row.qtyEa,
    qty_ctn: row.qtyCtn,
    weight_ratio_pct: row.weightRatioPct,
    value_ratio_pct: row.valueRatioPct,
    invoice_total_logistics_krw: row.invoiceTotalLogisticsKrw,
    invoice_total_freight_krw: row.invoiceTotalFreightKrw,
    invoice_total_duty_krw: row.invoiceTotalDutyKrw,
    invoice_total_other_krw: row.invoiceTotalOtherKrw,
    sku_logistics_alloc_krw: row.skuLogisticsAllocKrw,
    sku_logistics_unit_krw: row.skuLogisticsUnitKrw,
    sku_freight_unit_krw: row.skuFreightUnitKrw,
    sku_duty_unit_krw: row.skuDutyUnitKrw,
    sku_other_unit_krw: row.skuOtherUnitKrw,
    container_type: row.containerType,
    allocation_rule_version: row.allocationRuleVersion,
    etl_run_id: etlRunId,
  };
}

function buildMonthlyRows(rows: OceanAllocationRow[], etlRunId: string): MonthlySkuRow[] {
  const byKey = new Map<string, {
    month: string;
    carrierMode: string;
    resourceCode: string;
    resourceName: string;
    qtyEa: number;
    qtyCtn: number;
    skuLogisticsAllocKrw: number;
    skuFreightAllocKrw: number;
    skuDutyAllocKrw: number;
    skuOtherAllocKrw: number;
    bls: Set<string>;
    invoices: Set<string>;
    totalsByBl: Map<string, Pick<OceanAllocationRow, "invoiceTotalLogisticsKrw" | "invoiceTotalFreightKrw" | "invoiceTotalDutyKrw" | "invoiceTotalOtherKrw">>;
  }>();

  for (const row of rows) {
    const key = `${row.settlementMonth}:${row.carrierMode}:${row.resourceCode}`;
    const current = byKey.get(key) ?? {
      month: row.settlementMonth,
      carrierMode: row.carrierMode,
      resourceCode: row.resourceCode,
      resourceName: row.resourceName,
      qtyEa: 0,
      qtyCtn: 0,
      skuLogisticsAllocKrw: 0,
      skuFreightAllocKrw: 0,
      skuDutyAllocKrw: 0,
      skuOtherAllocKrw: 0,
      bls: new Set<string>(),
      invoices: new Set<string>(),
      totalsByBl: new Map(),
    };
    current.qtyEa += row.qtyEa;
    current.qtyCtn += row.qtyCtn;
    current.skuLogisticsAllocKrw += row.skuLogisticsAllocKrw;
    current.skuFreightAllocKrw += row.skuFreightUnitKrw * row.qtyEa;
    current.skuDutyAllocKrw += row.skuDutyUnitKrw * row.qtyEa;
    current.skuOtherAllocKrw += row.skuOtherUnitKrw * row.qtyEa;
    if (row.blNo) current.bls.add(row.blNo);
    if (row.invoiceNo) current.invoices.add(row.invoiceNo);
    if (row.blNo && !current.totalsByBl.has(row.blNo)) {
      current.totalsByBl.set(row.blNo, {
        invoiceTotalLogisticsKrw: row.invoiceTotalLogisticsKrw,
        invoiceTotalFreightKrw: row.invoiceTotalFreightKrw,
        invoiceTotalDutyKrw: row.invoiceTotalDutyKrw,
        invoiceTotalOtherKrw: row.invoiceTotalOtherKrw,
      });
    }
    byKey.set(key, current);
  }

  return Array.from(byKey.values()).map((row) => {
    const totals = Array.from(row.totalsByBl.values()).reduce(
      (acc, total) => ({
        logistics: acc.logistics + total.invoiceTotalLogisticsKrw,
        freight: acc.freight + total.invoiceTotalFreightKrw,
        duty: acc.duty + total.invoiceTotalDutyKrw,
        other: acc.other + total.invoiceTotalOtherKrw,
      }),
      { logistics: 0, freight: 0, duty: 0, other: 0 },
    );
    return {
      raw_key: `${row.month}:${row.carrierMode}:${row.resourceCode}`,
      month: row.month,
      carrier_mode: row.carrierMode,
      resource_code: row.resourceCode,
      resource_name: row.resourceName,
      qty_ea: row.qtyEa,
      qty_ctn: row.qtyCtn,
      bl_count: row.bls.size,
      invoice_count: row.invoices.size,
      monthly_total_logistics_krw: totals.logistics,
      monthly_total_freight_krw: totals.freight,
      monthly_total_duty_krw: totals.duty,
      monthly_total_other_krw: totals.other,
      sku_logistics_alloc_krw: row.skuLogisticsAllocKrw,
      sku_logistics_unit_krw: row.qtyEa > 0 ? row.skuLogisticsAllocKrw / row.qtyEa : 0,
      sku_freight_unit_krw: row.qtyEa > 0 ? row.skuFreightAllocKrw / row.qtyEa : 0,
      sku_duty_unit_krw: row.qtyEa > 0 ? row.skuDutyAllocKrw / row.qtyEa : 0,
      sku_other_unit_krw: row.qtyEa > 0 ? row.skuOtherAllocKrw / row.qtyEa : 0,
      allocation_rule_version: "ocean_v1",
      etl_run_id: etlRunId,
    };
  });
}

function summarizeAllocation(rows: OceanAllocationRow[]) {
  const totalsByBl = new Map<string, Pick<OceanAllocationRow, "invoiceTotalLogisticsKrw" | "invoiceTotalFreightKrw" | "invoiceTotalDutyKrw" | "invoiceTotalOtherKrw">>();
  for (const row of rows) {
    if (!totalsByBl.has(row.blNo)) {
      totalsByBl.set(row.blNo, {
        invoiceTotalLogisticsKrw: row.invoiceTotalLogisticsKrw,
        invoiceTotalFreightKrw: row.invoiceTotalFreightKrw,
        invoiceTotalDutyKrw: row.invoiceTotalDutyKrw,
        invoiceTotalOtherKrw: row.invoiceTotalOtherKrw,
      });
    }
  }
  return Array.from(totalsByBl.values()).reduce(
    (acc, row) => ({
      logisticsKrw: acc.logisticsKrw + row.invoiceTotalLogisticsKrw,
      freightKrw: acc.freightKrw + row.invoiceTotalFreightKrw,
      dutyKrw: acc.dutyKrw + row.invoiceTotalDutyKrw,
      otherKrw: acc.otherKrw + row.invoiceTotalOtherKrw,
    }),
    { logisticsKrw: 0, freightKrw: 0, dutyKrw: 0, otherKrw: 0 },
  );
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
