export interface UserSummary {
  email: string;
}

export interface InventorySnapshotRow {
  id?: string | number;
  date: string | null;
  snapshot_date?: string | null;
  snap_time?: string | null;
  center: string;
  resource_code: string;
  resource_name?: string | null;
  stock_qty?: number | null;
  available_qty?: number | null;
  sales_qty?: number | null;
}

export interface MoveRow {
  id?: string | number;
  date?: string | null;
  resource_code: string;
  resource_name?: string | null;
  from_center?: string | null;
  to_center: string;
  qty_ea: number;
  status?: string | null;
}

export interface DashboardFilters {
  centers: string[];
  skus: string[];
  dateFrom: string | null;
  dateTo: string | null;
  useTrendForecast: boolean;
  lookbackDays: number;
}

export interface KpiSummary {
  totalInventory: number;
  centerCount: number;
  skuCount: number;
  inboundQty: number;
  wipQty: number;
  shortageSkuCount: number;
}

export interface TimelinePoint {
  date: string;
  stockQty: number;
  inboundQty: number;
  forecastQty?: number | null;
}

export interface DashboardData {
  inventory: InventorySnapshotRow[];
  moves: MoveRow[];
  centerOptions: string[];
  skuOptions: string[];
  kpis: KpiSummary;
  timeline: TimelinePoint[];
  notices: string[];
}

export interface AllocationUploadRow {
  rowNumber: number;
  resource_code: string;
  center?: string | null;
  requested_qty: number;
}

export interface AllocationResultRow extends AllocationUploadRow {
  available_qty: number;
  allocated_qty: number;
  shortage_qty: number;
  status: "allocated" | "partial" | "shortage" | "unmatched";
}

export interface AllocationResponse {
  rows: AllocationResultRow[];
  notices: string[];
}
