export interface CjLotStockDbRow {
  created_at: Date | string;
  updated_at: Date | string;
  closeDt: Date | string;
  depotCd: string;
  prodLotNo: string;
  prodDt: string | null;
  ValidDim: string | null;
  prodCd: string;
  ProdNm: string;
  prodBrcd: string;
  stockCnt: number;
  avlbCnt: number;
  holdCnt: number;
  allocCnt: number;
  // Joined from the item master (scm_global_move_master_item).
  box_count: number | null;
  full_pallet_box_count: number | null;
  pallet_load_count: number | null;
}

export interface CjLotStockRow {
  created_at: string;
  updated_at: string;
  close_date: string;
  depot_code: string;
  lot_no: string;
  production_date: string | null;
  expiration_date: string | null;
  resource_code: string;
  resource_name: string;
  barcode: string;
  stock_qty: number;
  available_qty: number;
  hold_qty: number;
  allocated_qty: number;
  // Packaging master. null = SKU has no master 입수량 registered.
  units_per_box: number | null;
  boxes_per_pallet: number | null;
  units_per_pallet: number | null;
}

/** One SKU + expiry group, aggregated across centers, with box/pallet conversion. */
export interface CjStockSummaryRow {
  resource_code: string;
  resource_name: string;
  expiration_date: string | null;
  available_qty: number;
  lot_count: number;
  units_per_box: number | null;
  full_boxes: number | null;
  loose_units: number;
  est_pallets: number | null;
  box_status: "boxed" | "loose-only" | "unregistered";
}

export interface CjLotStockResponse {
  rows: CjLotStockRow[];
  meta: {
    table: string;
    limit: number;
    latestOnly: boolean;
    sku: string | null;
    depot: string | null;
  };
}

export interface CjAllocationRequestRow {
  rowNumber: number;
  resource_code: string;
  resource_name?: string | null;
  requested_qty: number;
  depot_code?: string | null;
  reference?: string | null;
}

export interface CjLotAllocationRow extends CjAllocationRequestRow {
  lot_no: string | null;
  expiration_date: string | null;
  available_qty: number;
  allocated_qty: number;
  shortage_qty: number;
  status: "allocated" | "partial" | "shortage" | "unmatched";
}

export interface CjAllocationResponse {
  rows: CjLotAllocationRow[];
  notices: string[];
  meta: {
    requestCount: number;
    allocationCount: number;
    skuCount: number;
    latestOnly: boolean;
  };
}
