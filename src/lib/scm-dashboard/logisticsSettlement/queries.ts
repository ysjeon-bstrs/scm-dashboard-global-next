import { queryBoostersScmReadOnly } from "../mysqlPools";
import { getSupabaseRestEnv, supabaseGetAll } from "./supabaseRest";

export type OceanSettlementLineRow = {
  rawKey: string;
  invoiceDate: string | null;
  blNo: string;
  country: string;
  chargeType: string;
  currency: string;
  amountOrig: number;
  exrate: number;
  amountKrw: number;
  taxKrw: number;
  containerType: string;
  fileName: string;
  fileId: string;
};

export type ShipmentAnalysisRow = {
  sourceLineId: number;
  invoiceNo: string;
  carrier: string;
  carrierMode: string;
  shipDate: string | null;
  fromWarehouse: string;
  toWarehouse: string;
  resourceCode: string;
  resourceName: string;
  qtyEa: number;
  qtyCtn: number;
  unitPriceUsd: number;
  amountUsd: number;
  blNo: string;
  kgTotal: number;
  cbmTotal: number;
  exportNo: string;
  vesselName: string;
  shippedYn: string;
  settlementMonth: string;
  analysisStatus: "analyzed" | "pending";
  weightRatioPct: number;
  valueRatioPct: number;
  invoiceTotalLogisticsKrw: number;
  invoiceTotalFreightKrw: number;
  invoiceTotalDutyKrw: number;
  invoiceTotalOtherKrw: number;
  skuLogisticsAllocKrw: number;
  skuLogisticsUnitKrw: number;
  skuFreightUnitKrw: number;
  skuDutyUnitKrw: number;
  skuOtherUnitKrw: number;
  containerType: string;
};

export type MonthlySkuCostRow = {
  rawKey: string;
  month: string;
  carrierMode: string;
  resourceCode: string;
  resourceName: string;
  qtyEa: number;
  qtyCtn: number;
  blCount: number;
  invoiceCount: number;
  monthlyTotalLogisticsKrw: number;
  monthlyTotalFreightKrw: number;
  monthlyTotalDutyKrw: number;
  monthlyTotalOtherKrw: number;
  skuLogisticsAllocKrw: number;
  skuLogisticsUnitKrw: number;
  skuFreightUnitKrw: number;
  skuDutyUnitKrw: number;
  skuOtherUnitKrw: number;
};

export type LogisticsSettlementSummary = {
  meta: {
    generatedAt: string;
    rowCount: number;
    analyzedRowCount: number;
    pendingRowCount: number;
    analyzedEa: number;
    totalEa: number;
    modes: string[];
  };
  totals: {
    qtyEa: number;
    qtyCtn: number;
    analyzedQtyEa: number;
    freightKrw: number;
    dutyKrw: number;
    otherKrw: number;
    logisticsKrw: number;
  };
  rows: ShipmentAnalysisRow[];
  oceanSettlementRows: OceanSettlementLineRow[];
  monthlyRows: MonthlySkuCostRow[];
};

type ShipmentDbRow = {
  sourceLineId: number | string;
  invoiceNo: string | null;
  carrier: string | null;
  carrierMode: string | null;
  shipDate: string | null;
  fromWarehouse: string | null;
  toWarehouse: string | null;
  resourceCode: string | null;
  resourceName: string | null;
  qtyEa: number | string | null;
  qtyCtn: number | string | null;
  unitPriceUsd: number | string | null;
  amountUsd: number | string | null;
  blNo: string | null;
  kgTotal: number | string | null;
  cbmTotal: number | string | null;
  exportNo: string | null;
  vesselName: string | null;
  shippedYn: string | null;
};

type MartDocSupabaseRow = {
  raw_key: string;
  source_line_id: number | string | null;
  settlement_month: string;
  bl_no: string;
  invoice_no: string;
  carrier: string;
  carrier_mode: string;
  from_warehouse: string;
  to_warehouse: string;
  resource_code: string;
  resource_name: string;
  qty_ea: number | string | null;
  qty_ctn: number | string | null;
  weight_ratio_pct: number | string | null;
  value_ratio_pct: number | string | null;
  invoice_total_logistics_krw: number | string | null;
  invoice_total_freight_krw: number | string | null;
  invoice_total_duty_krw: number | string | null;
  invoice_total_other_krw: number | string | null;
  sku_logistics_alloc_krw: number | string | null;
  sku_logistics_unit_krw: number | string | null;
  sku_freight_unit_krw: number | string | null;
  sku_duty_unit_krw: number | string | null;
  sku_other_unit_krw: number | string | null;
  container_type: string | null;
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

type MonthlySkuSupabaseRow = {
  raw_key: string;
  month: string;
  carrier_mode: string;
  resource_code: string;
  resource_name: string | null;
  qty_ea: number | string | null;
  qty_ctn: number | string | null;
  bl_count: number | string | null;
  invoice_count: number | string | null;
  monthly_total_logistics_krw: number | string | null;
  monthly_total_freight_krw: number | string | null;
  monthly_total_duty_krw: number | string | null;
  monthly_total_other_krw: number | string | null;
  sku_logistics_alloc_krw: number | string | null;
  sku_logistics_unit_krw: number | string | null;
  sku_freight_unit_krw: number | string | null;
  sku_duty_unit_krw: number | string | null;
  sku_other_unit_krw: number | string | null;
};

export async function fetchLogisticsSettlementSummary(options: { limit?: number } = {}): Promise<LogisticsSettlementSummary> {
  const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0 ? Math.min(options.limit, 5000) : 3000;
  const [shipments, martRows, oceanSettlementRows, monthlyRows] = await Promise.all([
    fetchShipmentRows(limit),
    fetchAllMartDocRows(),
    fetchAllOceanSettlementRows(),
    fetchMonthlySkuRows(),
  ]);
  const martBySourceLineId = new Map<number, MartDocSupabaseRow>();
  for (const row of martRows) {
    const id = numberValue(row.source_line_id);
    if (id) martBySourceLineId.set(id, row);
  }

  const rows = shipments.map((shipment) => toShipmentAnalysisRow(shipment, martBySourceLineId.get(numberValue(shipment.sourceLineId))));
  const analyzedRows = rows.filter((row) => row.analysisStatus === "analyzed");
  const totalEa = rows.reduce((sum, row) => sum + row.qtyEa, 0);
  const analyzedEa = analyzedRows.reduce((sum, row) => sum + row.qtyEa, 0);
  const totals = {
    qtyEa: totalEa,
    qtyCtn: rows.reduce((sum, row) => sum + row.qtyCtn, 0),
    analyzedQtyEa: analyzedEa,
    freightKrw: analyzedRows.reduce((sum, row) => sum + row.skuFreightUnitKrw * row.qtyEa, 0),
    dutyKrw: analyzedRows.reduce((sum, row) => sum + row.skuDutyUnitKrw * row.qtyEa, 0),
    otherKrw: analyzedRows.reduce((sum, row) => sum + row.skuOtherUnitKrw * row.qtyEa, 0),
    logisticsKrw: analyzedRows.reduce((sum, row) => sum + row.skuLogisticsAllocKrw, 0),
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      analyzedRowCount: analyzedRows.length,
      pendingRowCount: rows.length - analyzedRows.length,
      analyzedEa,
      totalEa,
      modes: Array.from(new Set(rows.map((row) => row.carrierMode).filter(Boolean))).sort(),
    },
    totals,
    rows,
    oceanSettlementRows,
    monthlyRows,
  };
}

async function fetchShipmentRows(limit: number) {
  return queryBoostersScmReadOnly<ShipmentDbRow>(`
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
      bl_no AS blNo,
      kg_total AS kgTotal,
      cbm_total AS cbmTotal,
      export_no AS exportNo,
      vessel_name AS vesselName,
      shipped_yn AS shippedYn
    FROM scm_global_move_shipments
    WHERE invoice_no <> ''
    ORDER BY COALESCE(onboard_date, created_at) DESC, id DESC
    LIMIT :limit
  `, { limit });
}

async function fetchAllMartDocRows() {
  const env = getSupabaseRestEnv({ requireServiceRole: true });
  const params = new URLSearchParams({
    select:
      "raw_key,source_line_id,settlement_month,bl_no,invoice_no,carrier,carrier_mode,from_warehouse,to_warehouse,resource_code,resource_name,qty_ea,qty_ctn,weight_ratio_pct,value_ratio_pct,invoice_total_logistics_krw,invoice_total_freight_krw,invoice_total_duty_krw,invoice_total_other_krw,sku_logistics_alloc_krw,sku_logistics_unit_krw,sku_freight_unit_krw,sku_duty_unit_krw,sku_other_unit_krw,container_type",
    order: "settlement_month.desc,bl_no.asc,resource_code.asc",
  });
  return supabaseGetAll<MartDocSupabaseRow>(env, "mart_logistics_doc_analysis", params);
}

async function fetchAllOceanSettlementRows() {
  const env = getSupabaseRestEnv({ requireServiceRole: true });
  const params = new URLSearchParams({
    select: "raw_key,invoice_date,bl_no,country,charge_type,currency,amount_orig,exrate,amount_krw,tax_krw,container_type,file_name,file_id",
    order: "invoice_date.desc,bl_no.asc,raw_key.asc",
    limit: "1000",
  });
  const rows = await supabaseGetAll<OceanSettlementSupabaseRow>(env, "stg_settlement_ocean_lines", params);
  return rows.map(toOceanSettlementLineRow);
}

async function fetchMonthlySkuRows() {
  const env = getSupabaseRestEnv({ requireServiceRole: true });
  const params = new URLSearchParams({
    select:
      "raw_key,month,carrier_mode,resource_code,resource_name,qty_ea,qty_ctn,bl_count,invoice_count,monthly_total_logistics_krw,monthly_total_freight_krw,monthly_total_duty_krw,monthly_total_other_krw,sku_logistics_alloc_krw,sku_logistics_unit_krw,sku_freight_unit_krw,sku_duty_unit_krw,sku_other_unit_krw",
    order: "month.desc,carrier_mode.asc,resource_code.asc",
    limit: "1000",
  });
  const rows = await supabaseGetAll<MonthlySkuSupabaseRow>(env, "mart_logistics_monthly_sku_cost", params);
  return rows.map(toMonthlySkuCostRow);
}

function toShipmentAnalysisRow(row: ShipmentDbRow, mart?: MartDocSupabaseRow): ShipmentAnalysisRow {
  const qtyEa = numberValue(row.qtyEa);
  return {
    sourceLineId: numberValue(row.sourceLineId),
    invoiceNo: String(row.invoiceNo ?? ""),
    carrier: String(row.carrier ?? ""),
    carrierMode: String(row.carrierMode ?? ""),
    shipDate: row.shipDate ? String(row.shipDate) : null,
    fromWarehouse: String(row.fromWarehouse ?? ""),
    toWarehouse: String(row.toWarehouse ?? ""),
    resourceCode: String(row.resourceCode ?? ""),
    resourceName: String(row.resourceName ?? ""),
    qtyEa,
    qtyCtn: numberValue(row.qtyCtn),
    unitPriceUsd: numberValue(row.unitPriceUsd),
    amountUsd: numberValue(row.amountUsd),
    blNo: String(row.blNo ?? ""),
    kgTotal: numberValue(row.kgTotal),
    cbmTotal: numberValue(row.cbmTotal),
    exportNo: String(row.exportNo ?? ""),
    vesselName: String(row.vesselName ?? ""),
    shippedYn: String(row.shippedYn ?? ""),
    settlementMonth: mart?.settlement_month ?? "",
    analysisStatus: mart ? "analyzed" : "pending",
    weightRatioPct: numberValue(mart?.weight_ratio_pct),
    valueRatioPct: numberValue(mart?.value_ratio_pct),
    invoiceTotalLogisticsKrw: numberValue(mart?.invoice_total_logistics_krw),
    invoiceTotalFreightKrw: numberValue(mart?.invoice_total_freight_krw),
    invoiceTotalDutyKrw: numberValue(mart?.invoice_total_duty_krw),
    invoiceTotalOtherKrw: numberValue(mart?.invoice_total_other_krw),
    skuLogisticsAllocKrw: numberValue(mart?.sku_logistics_alloc_krw),
    skuLogisticsUnitKrw: numberValue(mart?.sku_logistics_unit_krw),
    skuFreightUnitKrw: numberValue(mart?.sku_freight_unit_krw),
    skuDutyUnitKrw: numberValue(mart?.sku_duty_unit_krw),
    skuOtherUnitKrw: numberValue(mart?.sku_other_unit_krw),
    containerType: mart?.container_type ?? "",
  };
}

function toOceanSettlementLineRow(row: OceanSettlementSupabaseRow): OceanSettlementLineRow {
  return {
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
  };
}

function toMonthlySkuCostRow(row: MonthlySkuSupabaseRow): MonthlySkuCostRow {
  return {
    rawKey: row.raw_key,
    month: row.month,
    carrierMode: row.carrier_mode,
    resourceCode: row.resource_code,
    resourceName: row.resource_name ?? "",
    qtyEa: numberValue(row.qty_ea),
    qtyCtn: numberValue(row.qty_ctn),
    blCount: numberValue(row.bl_count),
    invoiceCount: numberValue(row.invoice_count),
    monthlyTotalLogisticsKrw: numberValue(row.monthly_total_logistics_krw),
    monthlyTotalFreightKrw: numberValue(row.monthly_total_freight_krw),
    monthlyTotalDutyKrw: numberValue(row.monthly_total_duty_krw),
    monthlyTotalOtherKrw: numberValue(row.monthly_total_other_krw),
    skuLogisticsAllocKrw: numberValue(row.sku_logistics_alloc_krw),
    skuLogisticsUnitKrw: numberValue(row.sku_logistics_unit_krw),
    skuFreightUnitKrw: numberValue(row.sku_freight_unit_krw),
    skuDutyUnitKrw: numberValue(row.sku_duty_unit_krw),
    skuOtherUnitKrw: numberValue(row.sku_other_unit_krw),
  };
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
