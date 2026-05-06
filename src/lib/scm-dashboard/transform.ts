import type {
  DashboardData,
  DashboardFilters,
  InventorySnapshotRow,
  KpiSummary,
  MoveRow,
  TimelinePoint,
} from "./types";

function toNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function getRowDate(row: InventorySnapshotRow) {
  return row.date ?? row.snapshot_date ?? null;
}

export function normalizeInventoryRows(rows: InventorySnapshotRow[]) {
  return rows.map((row) => ({
    ...row,
    date: getRowDate(row),
    center: row.center.trim(),
    resource_code: row.resource_code.trim(),
  }));
}

export function normalizeMoveRows(rows: MoveRow[]) {
  return rows.map((row) => ({
    ...row,
    resource_code: row.resource_code.trim(),
    to_center: row.to_center.trim(),
    qty_ea: toNumber(row.qty_ea),
  }));
}

export function buildFilterOptions(inventory: InventorySnapshotRow[]) {
  const centerOptions = Array.from(new Set(inventory.map((row) => row.center)))
    .filter(Boolean)
    .sort();
  const skuOptions = Array.from(
    new Set(inventory.map((row) => row.resource_code)),
  )
    .filter(Boolean)
    .sort();

  return { centerOptions, skuOptions };
}

export function applyDashboardFilters(
  inventory: InventorySnapshotRow[],
  filters: DashboardFilters,
) {
  return inventory.filter((row) => {
    const rowDate = getRowDate(row);
    const centerMatches =
      filters.centers.length === 0 || filters.centers.includes(row.center);
    const skuMatches =
      filters.skus.length === 0 || filters.skus.includes(row.resource_code);
    const dateFromMatches =
      !filters.dateFrom || !rowDate || rowDate >= filters.dateFrom;
    const dateToMatches = !filters.dateTo || !rowDate || rowDate <= filters.dateTo;

    return centerMatches && skuMatches && dateFromMatches && dateToMatches;
  });
}

export function buildKpiSummary(
  inventory: InventorySnapshotRow[],
  moves: MoveRow[],
): KpiSummary {
  const centers = new Set(inventory.map((row) => row.center));
  const skus = new Set(inventory.map((row) => row.resource_code));
  const totalInventory = inventory.reduce(
    (sum, row) => sum + toNumber(row.available_qty ?? row.stock_qty),
    0,
  );
  const inboundQty = moves.reduce((sum, row) => sum + toNumber(row.qty_ea), 0);
  const shortageSkuCount = inventory.filter(
    (row) => toNumber(row.available_qty ?? row.stock_qty) <= 0,
  ).length;

  return {
    totalInventory,
    centerCount: centers.size,
    skuCount: skus.size,
    inboundQty,
    wipQty: inboundQty,
    shortageSkuCount,
  };
}

export function buildTimeline(
  inventory: InventorySnapshotRow[],
  moves: MoveRow[],
  useTrendForecast: boolean,
): TimelinePoint[] {
  const byDate = new Map<string, TimelinePoint>();

  for (const row of inventory) {
    const date = getRowDate(row);
    if (!date) continue;
    const point = byDate.get(date) ?? { date, stockQty: 0, inboundQty: 0 };
    point.stockQty += toNumber(row.available_qty ?? row.stock_qty);
    byDate.set(date, point);
  }

  for (const row of moves) {
    if (!row.date) continue;
    const point = byDate.get(row.date) ?? {
      date: row.date,
      stockQty: 0,
      inboundQty: 0,
    };
    point.inboundQty += toNumber(row.qty_ea);
    byDate.set(row.date, point);
  }

  const points = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  if (!useTrendForecast || points.length < 2) {
    return points;
  }

  return points.map((point, index) => {
    if (index === 0) return { ...point, forecastQty: point.stockQty };
    const previous = points[index - 1];
    const trend = point.stockQty - previous.stockQty;
    return { ...point, forecastQty: Math.max(0, point.stockQty + trend) };
  });
}

export function createDashboardData(
  inventoryRows: InventorySnapshotRow[],
  moveRows: MoveRow[],
  filters: DashboardFilters,
  notices: string[] = [],
): DashboardData {
  const normalizedInventory = normalizeInventoryRows(inventoryRows);
  const inventory = applyDashboardFilters(normalizedInventory, filters);
  const moves = normalizeMoveRows(moveRows).filter((row) => {
    const centerMatches =
      filters.centers.length === 0 || filters.centers.includes(row.to_center);
    const skuMatches =
      filters.skus.length === 0 || filters.skus.includes(row.resource_code);
    return centerMatches && skuMatches;
  });
  const { centerOptions, skuOptions } = buildFilterOptions(normalizedInventory);

  return {
    inventory,
    moves,
    centerOptions,
    skuOptions,
    kpis: buildKpiSummary(inventory, moves),
    timeline: buildTimeline(inventory, moves, filters.useTrendForecast),
    notices,
  };
}
