import type {
  AllocationResultRow,
  AllocationUploadRow,
  InventorySnapshotRow,
} from "./types";

function getAvailableQty(row: InventorySnapshotRow) {
  return Number(row.available_qty ?? row.stock_qty ?? 0);
}

export function calculateAllocation(
  uploadRows: AllocationUploadRow[],
  inventoryRows: InventorySnapshotRow[],
): AllocationResultRow[] {
  const stockByKey = new Map<string, number>();

  for (const row of inventoryRows) {
    const key = `${row.center}::${row.resource_code}`;
    stockByKey.set(key, (stockByKey.get(key) ?? 0) + getAvailableQty(row));
  }

  return uploadRows.map((row) => {
    const center = row.center ?? "";
    const key = `${center}::${row.resource_code}`;
    const availableQty = stockByKey.get(key) ?? 0;
    const allocatedQty = Math.min(row.requested_qty, availableQty);
    const shortageQty = Math.max(0, row.requested_qty - allocatedQty);

    stockByKey.set(key, Math.max(0, availableQty - allocatedQty));

    return {
      ...row,
      available_qty: availableQty,
      allocated_qty: allocatedQty,
      shortage_qty: shortageQty,
      status:
        availableQty === 0
          ? "unmatched"
          : shortageQty === 0
            ? "allocated"
            : allocatedQty > 0
              ? "partial"
              : "shortage",
    };
  });
}
