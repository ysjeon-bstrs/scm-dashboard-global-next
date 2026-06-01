import type {
  CjAllocationRequestRow,
  CjLotAllocationRow,
  CjLotStockRow,
} from "./cjTypes";

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

function normalizeDepot(value: string | null | undefined) {
  return value?.trim() || null;
}

function toPositiveInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function getLotSortKey(row: CjLotStockRow) {
  return [
    row.expiration_date || "9999-12-31",
    row.production_date || "9999-12-31",
    row.lot_no,
    row.depot_code,
  ].join("|");
}

export function normalizeCjAllocationRequests(
  rows: CjAllocationRequestRow[],
): CjAllocationRequestRow[] {
  return rows
    .map((row) => ({
      ...row,
      resource_code: normalizeSku(row.resource_code),
      requested_qty: toPositiveInt(row.requested_qty),
      depot_code: normalizeDepot(row.depot_code),
      reference: row.reference?.trim() || null,
    }))
    .filter((row) => row.resource_code && row.requested_qty > 0);
}

export function allocateCjLotsFefo(
  requests: CjAllocationRequestRow[],
  lotStocks: CjLotStockRow[],
) {
  const availableByLot = new Map<string, CjLotStockRow & { remaining_qty: number }>();

  lotStocks.forEach((stock) => {
    const key = [
      normalizeSku(stock.resource_code),
      stock.depot_code,
      stock.lot_no,
      stock.expiration_date ?? "",
    ].join("|");
    const existing = availableByLot.get(key);
    const available_qty = toPositiveInt(stock.available_qty);

    if (existing) {
      existing.remaining_qty += available_qty;
      existing.available_qty += available_qty;
      return;
    }

    availableByLot.set(key, {
      ...stock,
      resource_code: normalizeSku(stock.resource_code),
      available_qty,
      remaining_qty: available_qty,
    });
  });

  const lots = Array.from(availableByLot.values()).sort((a, b) =>
    getLotSortKey(a).localeCompare(getLotSortKey(b)),
  );
  const allocations: CjLotAllocationRow[] = [];

  normalizeCjAllocationRequests(requests).forEach((request) => {
    let remaining = request.requested_qty;
    const requestDepot = normalizeDepot(request.depot_code);
    const matchingLots = lots.filter(
      (lot) =>
        lot.resource_code === request.resource_code &&
        (!requestDepot || lot.depot_code === requestDepot) &&
        lot.remaining_qty > 0,
    );

    matchingLots.forEach((lot) => {
      if (remaining <= 0) return;

      const allocated_qty = Math.min(remaining, lot.remaining_qty);
      lot.remaining_qty -= allocated_qty;
      remaining -= allocated_qty;

      allocations.push({
        ...request,
        depot_code: lot.depot_code,
        lot_no: lot.lot_no,
        expiration_date: lot.expiration_date,
        available_qty: lot.available_qty,
        allocated_qty,
        shortage_qty: 0,
        status: remaining === 0 ? "allocated" : "partial",
      });
    });

    if (remaining > 0) {
      allocations.push({
        ...request,
        lot_no: null,
        expiration_date: null,
        available_qty: matchingLots.reduce(
          (total, lot) => total + lot.available_qty,
          0,
        ),
        allocated_qty: request.requested_qty - remaining,
        shortage_qty: remaining,
        status: matchingLots.length > 0 ? "shortage" : "unmatched",
      });
    }
  });

  return allocations;
}

export function summarizeCjAllocationNotices(rows: CjLotAllocationRow[]) {
  const shortageQty = rows.reduce((sum, row) => sum + row.shortage_qty, 0);
  const unmatchedCount = rows.filter((row) => row.status === "unmatched").length;

  if (rows.length === 0) {
    return ["No valid allocation request rows were found."];
  }

  if (shortageQty > 0) {
    return [
      `Allocation completed with ${shortageQty.toLocaleString()} EA shortage across ${unmatchedCount.toLocaleString()} unmatched rows.`,
    ];
  }

  return [`Allocation completed for ${rows.length.toLocaleString()} lot rows.`];
}
