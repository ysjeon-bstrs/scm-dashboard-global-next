import type { CjLotStockRow, CjStockSummaryRow } from "./cjTypes";
import { normalizeExpiry } from "./cjValidation";

/**
 * Merge duplicate (depot + SKU + lot + expiry) rows by summing quantities —
 * port of _normalize_stock_rows_for_allocation. Prevents double-counted lot
 * rows in the detail grid and KPI lot count.
 */
export function dedupeCjStockRows(rows: CjLotStockRow[]): CjLotStockRow[] {
  const map = new Map<string, CjLotStockRow>();
  for (const row of rows) {
    const key = `${row.depot_code}|${row.resource_code}|${row.lot_no}|${normalizeExpiry(
      row.expiration_date ?? "",
    )}`;
    const existing = map.get(key);
    if (existing) {
      existing.available_qty += Number(row.available_qty) || 0;
      existing.stock_qty += Number(row.stock_qty) || 0;
      existing.hold_qty += Number(row.hold_qty) || 0;
      existing.allocated_qty += Number(row.allocated_qty) || 0;
    } else {
      map.set(key, {
        ...row,
        available_qty: Number(row.available_qty) || 0,
        stock_qty: Number(row.stock_qty) || 0,
        hold_qty: Number(row.hold_qty) || 0,
        allocated_qty: Number(row.allocated_qty) || 0,
      });
    }
  }
  return [...map.values()];
}

export interface CjStockKpis {
  totalAvailable: number;
  skuCount: number;
  lotCount: number;
  depotCount: number;
  /**
   * Billed pallets (conservative): ceil per SKU+expiry group — a partial pallet
   * bills as a whole one, and expiries are not merged. Runs slightly higher than
   * CJ's actual per-SKU billing, on purpose, so storage cost is never understated.
   */
  billedPallets: number;
  /** Groups holding stock but with no pallet master (excluded from billedPallets). */
  palletUnknownGroups: number;
}

export interface CjStockSummary {
  rows: CjStockSummaryRow[];
  kpis: CjStockKpis;
  /** SKUs present in stock but missing a master 입수량 (box_count NULL). */
  unregisteredSkus: string[];
}

interface SummaryAccumulator extends CjStockSummaryRow {
  lotKeys: Set<string>;
  unitsPerPallet: number | null;
}

/**
 * Aggregate raw CJ lot rows into SKU + expiry groups (across centers), then
 * convert available EA into full boxes, loose units, and estimated pallets
 * using the joined item-master packaging values.
 */
export function summarizeCjStock(stockRows: CjLotStockRow[]): CjStockSummary {
  const groups = new Map<string, SummaryAccumulator>();
  const skuSet = new Set<string>();
  const depotSet = new Set<string>();
  const unregistered = new Set<string>();
  let totalAvailable = 0;

  for (const row of stockRows) {
    const available = Number(row.available_qty) || 0;
    totalAvailable += available;
    skuSet.add(row.resource_code);
    if (row.depot_code) depotSet.add(row.depot_code);

    const key = `${row.resource_code}|${row.expiration_date ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        resource_code: row.resource_code,
        resource_name: row.resource_name,
        expiration_date: row.expiration_date,
        available_qty: 0,
        lot_count: 0,
        units_per_box: row.units_per_box,
        full_boxes: null,
        loose_units: 0,
        est_pallets: null,
        box_status: "unregistered",
        lotKeys: new Set<string>(),
        unitsPerPallet: row.units_per_pallet,
      };
      groups.set(key, group);
    }

    group.available_qty += available;
    if (group.units_per_box == null && row.units_per_box != null) {
      group.units_per_box = row.units_per_box;
    }
    if (group.unitsPerPallet == null && row.units_per_pallet != null) {
      group.unitsPerPallet = row.units_per_pallet;
    }

    const lotKey = `${row.depot_code}|${row.lot_no}`;
    if (!group.lotKeys.has(lotKey)) {
      group.lotKeys.add(lotKey);
      group.lot_count += 1;
    }
  }

  const rows: CjStockSummaryRow[] = [];
  let billedPallets = 0;
  let palletUnknownGroups = 0;
  for (const group of groups.values()) {
    const upb = group.units_per_box;
    const available = group.available_qty;
    const upp = group.unitsPerPallet;

    // Conservative pallet billing: each SKU+expiry group rounds up on its own.
    if (available > 0) {
      if (upp && upp > 0) {
        billedPallets += Math.ceil(available / upp);
      } else {
        palletUnknownGroups += 1;
      }
    }

    if (upb == null) {
      group.box_status = "unregistered";
      group.full_boxes = null;
      group.loose_units = available;
      group.est_pallets = null;
      unregistered.add(group.resource_code);
    } else if (upb <= 0) {
      // Registered as loose-only (no box pack), but stock can still exist.
      group.box_status = "loose-only";
      group.full_boxes = 0;
      group.loose_units = available;
      group.est_pallets = null;
    } else {
      group.box_status = "boxed";
      group.full_boxes = Math.floor(available / upb);
      group.loose_units = available % upb;
      group.est_pallets = upp && upp > 0 ? available / upp : null;
    }

    const { lotKeys: _lotKeys, unitsPerPallet: _unitsPerPallet, ...summaryRow } =
      group;
    void _lotKeys;
    void _unitsPerPallet;
    rows.push(summaryRow);
  }

  rows.sort((a, b) => {
    if (a.resource_code !== b.resource_code) {
      return a.resource_code.localeCompare(b.resource_code);
    }
    return (a.expiration_date ?? "").localeCompare(b.expiration_date ?? "");
  });

  return {
    rows,
    kpis: {
      totalAvailable,
      skuCount: skuSet.size,
      lotCount: stockRows.length,
      depotCount: depotSet.size,
      billedPallets,
      palletUnknownGroups,
    },
    unregisteredSkus: Array.from(unregistered).sort(),
  };
}
