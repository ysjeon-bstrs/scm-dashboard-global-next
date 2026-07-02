/**
 * CJ lot allocation + CJ WMS export — port of cj_outbound.py.
 *
 * Allocation is constrained to the order's requested expiry (not free FEFO):
 * within that SKU+expiry's lots (lot order), fill full boxes, then combine
 * sub-box remainders of the same expiry into mixed boxes.
 */
import type { CjLotStockRow } from "./cjTypes.ts";
import { normalizeCjSku, normalizeExpiry, type FbaShipmentRow } from "./cjValidation.ts";

export const DEFAULT_CJ_SALES_UNIT_PRICE = 10000;

export interface LotAllocation {
  shipment_id: string;
  fc: string;
  sku: string;
  expiry_display: string;
  lot: string;
  allocated_qty: number;
  allocated_boxes: number;
  box_start: number;
  box_end: number;
  is_mixed: boolean;
}

interface StockLot {
  lot: string;
  available_qty: number;
}

const US_STATE_ABBREVS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const US_STATE_NAME_TO_ABBREV: Record<string, string> = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",
  connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",
  illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",
  maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",
  mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",
  pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA",
  "west virginia":"WV",wisconsin:"WI",wyoming:"WY","district of columbia":"DC",
};

export interface ParsedAddress {
  city: string;
  state: string;
  address: string;
  zipcode: string;
}

function parseCommaSeparated(address: string, out: ParsedAddress): boolean {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return false;
  const country = parts[parts.length - 1].toUpperCase();
  if (!["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(country)) {
    return false;
  }
  const zipText = parts[parts.length - 2];
  const stateText = parts[parts.length - 3].toLowerCase();
  const city = parts[parts.length - 4];
  const street = parts.slice(0, parts.length - 4).join(", ");
  const state =
    US_STATE_NAME_TO_ABBREV[stateText] ?? parts[parts.length - 3].toUpperCase();
  if (!US_STATE_ABBREVS.has(state)) return false;
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(zipText);
  out.zipcode = zip ? zip[1] : "";
  out.state = state;
  out.city = city;
  out.address = street;
  return true;
}

function parseWithDash(address: string, out: ParsedAddress): void {
  const parts = address.split(/\s*[–—]\s*/);
  const streetZip = parts.length >= 2 ? parts[0].trim() : address;
  const cityState = parts.length >= 2 ? parts.slice(1).join(" – ").trim() : "";
  if (cityState) {
    const lastComma = cityState.lastIndexOf(",");
    if (lastComma > 0) {
      out.city = cityState.slice(0, lastComma).trim();
      out.state = cityState.slice(lastComma + 1).trim();
    } else {
      out.city = cityState;
    }
  }
  const zipEnd = /\b(\d{5})(?:-\d{4})?\s*$/.exec(streetZip);
  if (zipEnd) {
    out.zipcode = zipEnd[1];
    out.address = streetZip.slice(0, zipEnd.index).trim();
    return;
  }
  const matches = [...streetZip.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    out.zipcode = last[1];
    out.address = streetZip.slice(0, last.index).trim();
  } else {
    out.address = streetZip;
  }
}

function parseWithoutDash(address: string, out: ParsedAddress): void {
  let remaining = address;
  const zip = /\b(\d{5})\s*$/.exec(address);
  if (zip) {
    out.zipcode = zip[1];
    remaining = address.slice(0, zip.index).trim();
  }
  let words = remaining.split(/\s+/).filter(Boolean);
  if (words.length > 0 && US_STATE_ABBREVS.has(words[words.length - 1].toUpperCase())) {
    out.state = words[words.length - 1].toUpperCase();
    words = words.slice(0, -1);
  }
  const directions = new Set(["SW", "NW", "SE", "NE", "N", "S", "E", "W"]);
  if (words.length > 0 && !directions.has(words[words.length - 1].toUpperCase())) {
    out.city = words[words.length - 1];
    words = words.slice(0, -1);
  }
  out.address = words.join(" ");
}

export function parseFbaAddress(address: string): ParsedAddress {
  const out: ParsedAddress = { city: "", state: "", address: "", zipcode: "" };
  const text = (address ?? "").trim();
  if (!text) return out;
  if (parseCommaSeparated(text, out)) return out;
  if (/[–—]/.test(text)) parseWithDash(text, out);
  else parseWithoutDash(text, out);
  return out;
}

/** Lots for a SKU + exact expiry at the warehouse, sorted by lot number. */
export function lotsForRequest(
  warehouseStock: CjLotStockRow[],
  sku: string,
  expiryNorm: string,
): StockLot[] {
  return warehouseStock
    .filter(
      (r) =>
        normalizeCjSku(r.resource_code) === normalizeCjSku(sku) &&
        normalizeExpiry(r.expiration_date ?? "") === expiryNorm,
    )
    .map((r) => ({ lot: r.lot_no, available_qty: Number(r.available_qty) || 0 }))
    .sort((a, b) => a.lot.localeCompare(b.lot));
}

/** Allocate one shipment row against its requested-expiry lots. */
export function allocateRow(
  row: FbaShipmentRow,
  lots: StockLot[],
): LotAllocation[] {
  const boxUnit = row.box_unit;
  const allocations: LotAllocation[] = [];
  const leftovers: Array<{ lot: string; qty: number }> = [];
  let remaining = row.qty;
  let boxCursor = row.box_start;

  // 1) Full boxes per lot + collect sub-box remainders.
  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.available_qty <= 0) continue;
    const allocateQty = Math.min(remaining, lot.available_qty);
    let allocateBoxes = 0;
    let boxAllocatedQty = 0;
    let leftoverQty = 0;
    if (boxUnit > 0) {
      allocateBoxes = Math.floor(allocateQty / boxUnit);
      boxAllocatedQty = allocateBoxes * boxUnit;
      leftoverQty = Math.min(
        remaining - boxAllocatedQty,
        allocateQty - boxAllocatedQty,
      );
    }
    if (boxAllocatedQty > 0) {
      allocations.push({
        shipment_id: row.shipment_id,
        fc: row.fc,
        sku: row.sku,
        expiry_display: row.expiry_display,
        lot: lot.lot,
        allocated_qty: boxAllocatedQty,
        allocated_boxes: allocateBoxes,
        box_start: boxCursor,
        box_end: boxCursor + allocateBoxes - 1,
        is_mixed: false,
      });
      remaining -= boxAllocatedQty;
      boxCursor += allocateBoxes;
    }
    if (remaining > 0 && leftoverQty > 0) {
      leftovers.push({ lot: lot.lot, qty: leftoverQty });
    }
  }

  // 2) Combine same-expiry remainders into mixed boxes.
  if (remaining > 0 && boxUnit > 0 && leftovers.length > 0) {
    let idx = 0;
    let used = 0;
    while (remaining > 0 && idx < leftovers.length) {
      const boxFill = Math.min(remaining, boxUnit);
      const boxAllocs: LotAllocation[] = [];
      let filled = 0;
      while (filled < boxFill && idx < leftovers.length) {
        const { lot, qty } = leftovers[idx];
        const availFromLot = qty - used;
        if (availFromLot <= 0) {
          idx += 1;
          used = 0;
          continue;
        }
        const useQty = Math.min(boxFill - filled, availFromLot);
        filled += useQty;
        used += useQty;
        boxAllocs.push({
          shipment_id: row.shipment_id,
          fc: row.fc,
          sku: row.sku,
          expiry_display: row.expiry_display,
          lot,
          allocated_qty: useQty,
          allocated_boxes: 0,
          box_start: boxCursor,
          box_end: boxCursor,
          is_mixed: true,
        });
        if (used >= qty) {
          idx += 1;
          used = 0;
        }
      }
      if (filled === boxUnit) {
        if (boxAllocs.length > 0) {
          boxAllocs[boxAllocs.length - 1].allocated_boxes = 1;
        }
        allocations.push(...boxAllocs);
        remaining -= filled;
        boxCursor += 1;
      } else {
        break; // partial box — stop
      }
    }
  }

  return allocations;
}

export interface ExpiryShortage {
  sku: string;
  expiry: string; // display form
  demand: number;
  available: number;
  shortage: number;
}

/**
 * Pre-allocation sufficiency check: aggregate demand per SKU+expiry across all
 * rows and compare to warehouse availability (port of _check_stock_sufficiency).
 */
export function checkSufficiency(
  rows: FbaShipmentRow[],
  warehouseStock: CjLotStockRow[],
): ExpiryShortage[] {
  const demand = new Map<string, { sku: string; expiry: string; qty: number }>();
  for (const row of rows) {
    const key = `${normalizeCjSku(row.sku)}|${row.expiry_norm}`;
    const entry = demand.get(key) ?? {
      sku: row.sku,
      expiry: row.expiry_display,
      qty: 0,
    };
    entry.qty += row.qty;
    demand.set(key, entry);
  }

  const available = new Map<string, number>();
  for (const stock of warehouseStock) {
    const key = `${normalizeCjSku(stock.resource_code)}|${normalizeExpiry(stock.expiration_date ?? "")}`;
    available.set(key, (available.get(key) ?? 0) + (Number(stock.available_qty) || 0));
  }

  const shortages: ExpiryShortage[] = [];
  for (const [key, { sku, expiry, qty }] of demand) {
    const avail = available.get(key) ?? 0;
    if (qty > avail) {
      shortages.push({ sku, expiry, demand: qty, available: avail, shortage: qty - avail });
    }
  }
  return shortages;
}

export interface AllocationResult {
  allocations: LotAllocation[];
  shortageEa: number;
  allocatedEa: number;
  requestedEa: number;
}

/**
 * `selectedLots` entries are composite keys `SKU|expiryNorm|lotNo` (the same
 * shape as the internal availability keys) — a bare lot number would collide
 * when the same lot id recurs across SKUs or expiries.
 */
export function allocateOrder(
  rows: FbaShipmentRow[],
  warehouseStock: CjLotStockRow[],
  selectedLots: Set<string> | null = null,
): AllocationResult {
  // Working availability per SKU+expiry+lot, decremented across rows so the
  // same lot isn't double-allocated (port of _allocate_sku_with_lots).
  const avail = new Map<string, number>();
  for (const stock of warehouseStock) {
    const key = `${normalizeCjSku(stock.resource_code)}|${normalizeExpiry(stock.expiration_date ?? "")}|${stock.lot_no}`;
    avail.set(key, (avail.get(key) ?? 0) + (Number(stock.available_qty) || 0));
  }

  const allocations: LotAllocation[] = [];
  let requestedEa = 0;
  let allocatedEa = 0;

  for (const row of rows) {
    requestedEa += row.qty;
    const prefix = `${normalizeCjSku(row.sku)}|${row.expiry_norm}|`;
    const lots: StockLot[] = [...avail.entries()]
      .filter(([key, qty]) => key.startsWith(prefix) && qty > 0)
      .map(([key, qty]) => ({ lot: key.slice(prefix.length), available_qty: qty }))
      .filter((lot) => !selectedLots || selectedLots.has(prefix + lot.lot))
      .sort((a, b) => a.lot.localeCompare(b.lot));

    const rowAllocs = allocateRow(row, lots);
    allocations.push(...rowAllocs);
    allocatedEa += rowAllocs.reduce((s, a) => s + a.allocated_qty, 0);

    for (const a of rowAllocs) {
      const key = `${row.sku}|${row.expiry_norm}|${a.lot}`;
      avail.set(key, (avail.get(key) ?? 0) - a.allocated_qty);
    }
  }

  return {
    allocations,
    requestedEa,
    allocatedEa,
    shortageEa: requestedEa - allocatedEa,
  };
}

export interface CjWmsRow {
  주문번호: string;
  "FBA Shipment ID": string;
  품목코드: string;
  상품명: string;
  LOT넘버: string;
  주문수량: number;
  결제금액: number;
  판매단가: number;
  수취인명: string;
  휴대전화번호: string;
  CITY: string;
  STATE: string;
  주소: string;
  주소2: string;
  우편번호: string;
  출발국가: string;
  도착국가: string;
  "Validation Key": string;
  Units: number;
  FBA: string;
  주문일시: string;
}

export function formatCjOmsOrderDate(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(2);
  return `${month}/${day}/${year}`;
}

const INVALID = new Set(["", "nan", "none", "null"]);

export function buildCjWmsRows(
  allocations: LotAllocation[],
  rows: FbaShipmentRow[],
  orderDate: Date = new Date(),
): CjWmsRow[] {
  const shipInfo = new Map<string, FbaShipmentRow>();
  for (const row of rows) {
    shipInfo.set(
      `${row.shipment_id}_${row.fc}_${row.sku}_${row.expiry_display}`,
      row,
    );
  }

  const out: CjWmsRow[] = [];
  let counter = 0;
  const orderDateText = formatCjOmsOrderDate(orderDate);

  const orderNo = (row: FbaShipmentRow, box: number) => {
    if (row.fulfillment_type === "FBT") {
      const width = row.box_num_width || 4;
      const prefix = row.box_prefix || "C";
      return `IBR${row.shipment_id}-${prefix}${String(box).padStart(width, "0")}`;
    }
    return `${row.shipment_id}U${String(box).padStart(6, "0")}`;
  };

  for (const alloc of allocations) {
    const row = shipInfo.get(
      `${alloc.shipment_id}_${alloc.fc}_${alloc.sku}_${alloc.expiry_display}`,
    );
    if (!row) continue;

    const altValid =
      row.alt_address && !INVALID.has(row.alt_address.toLowerCase());
    const parsed = parseFbaAddress(altValid ? row.alt_address : row.address);
    const validationKey = `${alloc.fc}${alloc.sku}`;
    const boxUnit = row.box_unit;
    const isMixed = alloc.allocated_qty < boxUnit * Math.max(1, alloc.allocated_boxes);

    const makeRow = (no: string, qty: number): CjWmsRow => {
      const r: CjWmsRow = {
        주문번호: no,
        "FBA Shipment ID": row.reference_number,
        품목코드: alloc.sku,
        상품명: row.product_name,
        LOT넘버: alloc.lot,
        주문수량: qty,
        결제금액: DEFAULT_CJ_SALES_UNIT_PRICE * qty,
        판매단가: DEFAULT_CJ_SALES_UNIT_PRICE,
        수취인명: alloc.fc,
        휴대전화번호: `010-1234-${1235 + counter}`,
        CITY: parsed.city,
        STATE: parsed.state,
        주소: parsed.address,
        주소2: "",
        우편번호: parsed.zipcode,
        출발국가: "US",
        도착국가: "US",
        "Validation Key": validationKey,
        Units: qty,
        FBA: `${no}.pdf`,
        주문일시: orderDateText,
      };
      counter += 1;
      return r;
    };

    if (isMixed) {
      out.push(makeRow(orderNo(row, alloc.box_start), alloc.allocated_qty));
    } else {
      for (let box = alloc.box_start; box <= alloc.box_end; box += 1) {
        out.push(makeRow(orderNo(row, box), boxUnit));
      }
    }
  }

  return out;
}
