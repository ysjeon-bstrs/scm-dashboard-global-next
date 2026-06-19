import { getSupabaseRestEnv, supabaseGetAll } from "./supabaseRest";

export type OceanAllocationListRow = {
  rawKey: string;
  settlementMonth: string;
  blNo: string;
  invoiceNo: string;
  carrier: string;
  fromWarehouse: string;
  toWarehouse: string;
  resourceCode: string;
  resourceName: string;
  qtyEa: number;
  qtyCtn: number;
  skuFreightUnitKrw: number;
  skuDutyUnitKrw: number;
  skuOtherUnitKrw: number;
  skuLogisticsUnitKrw: number;
  skuLogisticsAllocKrw: number;
  containerType: string;
};

export type OceanExceptionRow = {
  code: string;
  label: string;
  count: number;
  tone: "neutral" | "warn" | "danger";
};

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

export type OceanSettlementSummary = {
  meta: {
    generatedAt: string;
    settlementMonth: string | null;
    rowCount: number;
    blCount: number;
    invoiceCount: number;
  };
  totals: {
    qtyEa: number;
    qtyCtn: number;
    freightKrw: number;
    dutyKrw: number;
    otherKrw: number;
    logisticsKrw: number;
  };
  rows: OceanAllocationListRow[];
  exceptions: OceanExceptionRow[];
};

type MartDocSupabaseRow = {
  raw_key: string;
  settlement_month: string;
  bl_no: string;
  invoice_no: string;
  carrier: string;
  from_warehouse: string;
  to_warehouse: string;
  resource_code: string;
  resource_name: string;
  qty_ea: number | string | null;
  qty_ctn: number | string | null;
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

export async function fetchOceanSettlementSummary(filters: {
  month?: string | null;
  limit?: number;
}): Promise<OceanSettlementSummary> {
  const env = getSupabaseRestEnv();
  const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0 ? Math.min(filters.limit, 2000) : 500;
  const params = new URLSearchParams({
    select:
      "raw_key,settlement_month,bl_no,invoice_no,carrier,from_warehouse,to_warehouse,resource_code,resource_name,qty_ea,qty_ctn,invoice_total_logistics_krw,invoice_total_freight_krw,invoice_total_duty_krw,invoice_total_other_krw,sku_logistics_alloc_krw,sku_logistics_unit_krw,sku_freight_unit_krw,sku_duty_unit_krw,sku_other_unit_krw,container_type",
    carrier_mode: "eq.해상",
    order: "settlement_month.desc,bl_no.asc,resource_code.asc",
  });
  if (filters.month) params.set("settlement_month", `eq.${filters.month}`);
  params.set("limit", String(limit));

  const rawRows = await supabaseGetAll<MartDocSupabaseRow>(env, "mart_logistics_doc_analysis", params);
  const rows = rawRows.map(toOceanAllocationListRow);
  const totals = summarizeRows(rawRows);
  const blCount = new Set(rows.map((row) => row.blNo).filter(Boolean)).size;
  const invoiceCount = new Set(rows.map((row) => row.invoiceNo).filter(Boolean)).size;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      settlementMonth: filters.month ?? null,
      rowCount: rows.length,
      blCount,
      invoiceCount,
    },
    totals,
    rows,
    exceptions: buildExceptionSummary(rows),
  };
}

export async function fetchOceanBlDrilldown(blNo: string) {
  const env = getSupabaseRestEnv();
  const encodedBl = blNo.trim();
  if (!encodedBl) return { allocations: [], settlementLines: [] };

  const allocationParams = new URLSearchParams({
    select:
      "raw_key,settlement_month,bl_no,invoice_no,carrier,from_warehouse,to_warehouse,resource_code,resource_name,qty_ea,qty_ctn,invoice_total_logistics_krw,invoice_total_freight_krw,invoice_total_duty_krw,invoice_total_other_krw,sku_logistics_alloc_krw,sku_logistics_unit_krw,sku_freight_unit_krw,sku_duty_unit_krw,sku_other_unit_krw,container_type",
    carrier_mode: "eq.해상",
    bl_no: `eq.${encodedBl}`,
    order: "resource_code.asc",
  });
  const settlementParams = new URLSearchParams({
    select: "raw_key,invoice_date,bl_no,country,charge_type,currency,amount_orig,exrate,amount_krw,tax_krw,container_type,file_name,file_id",
    bl_no: `eq.${encodedBl}`,
    order: "invoice_date.asc,raw_key.asc",
  });

  const [allocations, settlementRows] = await Promise.all([
    supabaseGetAll<MartDocSupabaseRow>(env, "mart_logistics_doc_analysis", allocationParams),
    supabaseGetAll<OceanSettlementSupabaseRow>(env, "stg_settlement_ocean_lines", settlementParams),
  ]);

  return {
    allocations: allocations.map(toOceanAllocationListRow),
    settlementLines: settlementRows.map((row): OceanSettlementLineRow => ({
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
    })),
  };
}

function toOceanAllocationListRow(row: MartDocSupabaseRow): OceanAllocationListRow {
  return {
    rawKey: row.raw_key,
    settlementMonth: row.settlement_month,
    blNo: row.bl_no,
    invoiceNo: row.invoice_no,
    carrier: row.carrier,
    fromWarehouse: row.from_warehouse,
    toWarehouse: row.to_warehouse,
    resourceCode: row.resource_code,
    resourceName: row.resource_name,
    qtyEa: numberValue(row.qty_ea),
    qtyCtn: numberValue(row.qty_ctn),
    skuFreightUnitKrw: numberValue(row.sku_freight_unit_krw),
    skuDutyUnitKrw: numberValue(row.sku_duty_unit_krw),
    skuOtherUnitKrw: numberValue(row.sku_other_unit_krw),
    skuLogisticsUnitKrw: numberValue(row.sku_logistics_unit_krw),
    skuLogisticsAllocKrw: numberValue(row.sku_logistics_alloc_krw),
    containerType: row.container_type ?? "",
  };
}

function summarizeRows(rows: MartDocSupabaseRow[]) {
  const totalsByBl = new Map<string, {
    logistics: number;
    freight: number;
    duty: number;
    other: number;
  }>();
  let qtyEa = 0;
  let qtyCtn = 0;
  for (const row of rows) {
    qtyEa += numberValue(row.qty_ea);
    qtyCtn += numberValue(row.qty_ctn);
    if (!totalsByBl.has(row.bl_no)) {
      totalsByBl.set(row.bl_no, {
        logistics: numberValue(row.invoice_total_logistics_krw),
        freight: numberValue(row.invoice_total_freight_krw),
        duty: numberValue(row.invoice_total_duty_krw),
        other: numberValue(row.invoice_total_other_krw),
      });
    }
  }

  const nonAdditiveTotals = Array.from(totalsByBl.values()).reduce(
    (acc, row) => ({
      logisticsKrw: acc.logisticsKrw + row.logistics,
      freightKrw: acc.freightKrw + row.freight,
      dutyKrw: acc.dutyKrw + row.duty,
      otherKrw: acc.otherKrw + row.other,
    }),
    { logisticsKrw: 0, freightKrw: 0, dutyKrw: 0, otherKrw: 0 },
  );

  return { qtyEa, qtyCtn, ...nonAdditiveTotals };
}

function buildExceptionSummary(rows: OceanAllocationListRow[]): OceanExceptionRow[] {
  const noContainer = rows.filter((row) => !row.containerType).length;
  const twentyFt = rows.filter((row) => /20/.test(row.containerType)).length;
  return [
    { code: "NO_CONTAINER_TYPE", label: "컨테이너 미지정", count: noContainer, tone: noContainer ? "warn" : "neutral" },
    { code: "TWENTY_FT_REFERENCE", label: "20ft/별도 기준 후보", count: twentyFt, tone: twentyFt ? "warn" : "neutral" },
  ];
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
