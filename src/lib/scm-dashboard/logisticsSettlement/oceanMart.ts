import type { OceanAllocationRow } from "./types";

export const OCEAN_PIPELINE = "logistics_settlement_ocean_v1";

export type MartDocRow = Record<string, string | number | null>;
export type MonthlySkuRow = Record<string, string | number | null>;

export type OceanAllocationTotals = {
  logisticsKrw: number;
  freightKrw: number;
  dutyKrw: number;
  otherKrw: number;
};

export type OceanCleanupPlan = {
  eligible: boolean;
  reason: string | null;
  scope: "month" | "all";
  month: string | null;
};

/**
 * Decide whether/how a recompute may delete stale ocean_v1 mart rows.
 * - Scope is the TARGET month (the requested `month`), not the months produced by allocation.
 * - A partial run (`limit` set) must NOT clean up: it only processes a subset, so deleting
 *   "stale" rows would drop data the partial run never regenerated.
 */
export function planOceanCleanup(options: { month?: string; limit?: number }): OceanCleanupPlan {
  const scope = options.month ? "month" : "all";
  const month = options.month ?? null;
  if (options.limit) {
    return { eligible: false, reason: "partial run (limit set): cleanup skipped", scope, month };
  }
  return { eligible: true, reason: null, scope, month };
}

export function toMartDocRow(row: OceanAllocationRow, etlRunId: string): MartDocRow {
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

export function buildMonthlyRows(rows: OceanAllocationRow[], etlRunId: string): MonthlySkuRow[] {
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
    // Sum the integer per-row bucket allocations directly so the monthly buckets
    // reconcile to logistics exactly (no rounded-unit×qty round-trip, safe for qty=0).
    current.skuFreightAllocKrw += row.skuFreightKrw;
    current.skuDutyAllocKrw += row.skuDutyKrw;
    current.skuOtherAllocKrw += row.skuOtherKrw;
    if (row.blNo) current.bls.add(row.blNo);
    if (row.invoiceNo) current.invoices.add(row.invoiceNo);
    // Invariant: allocateOceanSettlement writes identical invoice_total_* on every row
    // of a BL, so taking the first row per BL is a correct (not lossy) dedup here.
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

export function summarizeAllocation(rows: OceanAllocationRow[]): OceanAllocationTotals {
  const totalsByBl = new Map<string, Pick<OceanAllocationRow, "invoiceTotalLogisticsKrw" | "invoiceTotalFreightKrw" | "invoiceTotalDutyKrw" | "invoiceTotalOtherKrw">>();
  // invoice_total_* is identical across all rows of a BL (see allocateOceanSettlement),
  // so first-seen-per-BL avoids double-counting the BL total across its SKU rows.
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

export function buildOceanEtlRunLogRow(input: {
  etlRunId: string;
  movementRowCount: number;
  settlementRowCount: number;
  martRowCount: number;
  monthlyRowCount: number;
  summary: unknown;
}): Record<string, unknown> {
  return {
    etl_run_id: input.etlRunId,
    pipeline: OCEAN_PIPELINE,
    status: "SUCCESS",
    snapshot_date: null,
    finished_at: new Date().toISOString(),
    source_rows: input.movementRowCount,
    raw_rows: input.settlementRowCount,
    mart_lot_rows: input.martRowCount,
    mart_sku_rows: input.monthlyRowCount,
    summary: input.summary,
    error_message: null,
  };
}
