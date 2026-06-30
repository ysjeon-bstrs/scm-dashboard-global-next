import { queryCrewDbReadOnly } from "./mysqlPools";

export type AcrossbWarehouseCode = "AXB-NL-DKW-1" | "AXB-UK-HMI-1";

export interface AcrossbWarehouseRow {
  inventory_group_code: AcrossbWarehouseCode;
  warehouse_code: AcrossbWarehouseCode;
  warehouse_name: string;
  country_code: string;
  country_name: string;
  timezone: string;
}

export interface AcrossbInventoryRow {
  warehouse_code: AcrossbWarehouseCode;
  warehouse_name: string;
  country_code: string;
  sku: string;
  name: string;
  barcode: string;
  reference_number: string;
  source_transaction_id: string;
  line_item_id: string;
  inventory_unit_of_measure: string;
  packaging_unit_of_measure: string;
  inventory_age_days: number | null;
  received_at: string | null;
  received_qty: number;
  on_hand_qty: number;
  available_qty: number;
  on_hold_qty: number;
  lot_number: string;
  expiration_date: string | null;
  location_code: string;
  updated_at: string | null;
}

export interface AcrossbSkuSummaryRow {
  warehouse_code: AcrossbWarehouseCode;
  warehouse_name: string;
  country_code: string;
  sku: string;
  name: string;
  lot_count: number;
  row_count: number;
  on_hand_qty: number;
  available_qty: number;
  on_hold_qty: number;
  received_qty: number;
  nearest_expiration_date: string | null;
  oldest_received_at: string | null;
  max_inventory_age_days: number | null;
}

export interface AcrossbInboundRequestRow {
  inbound_id: string;
  warehouse_code: AcrossbWarehouseCode;
  warehouse_name: string;
  country_code: string;
  status: string;
  transport_method: string;
  reference_number: string;
  requested_at: string | null;
  requested_by: string;
  expected_inbound_date: string | null;
  completed_inbound_date: string | null;
  master_bl_number: string;
  house_bl_number: string;
  master_awb_number: string;
  house_awb_number: string;
  item_rows: number;
  sku_count: number;
  unit_quantity: number;
  carton_quantity: number;
  pallet_quantity: number;
}

export interface AcrossbWarehouseSummary {
  warehouse_code: AcrossbWarehouseCode;
  warehouse_name: string;
  country_code: string;
  timezone: string;
  row_count: number;
  sku_count: number;
  lot_count: number;
  on_hand_qty: number;
  available_qty: number;
  on_hold_qty: number;
  inbound_request_count: number;
  inbound_unit_quantity: number;
  latest_inventory_updated_at: string | null;
}

export interface AcrossbSummary {
  meta: {
    generated_at: string;
    warehouse_codes: AcrossbWarehouseCode[];
    latest_inventory_updated_at: string | null;
    warehouse_count: number;
    inventory_row_count: number;
    sku_count: number;
    lot_count: number;
    inbound_request_count: number;
  };
  totals: {
    on_hand_qty: number;
    available_qty: number;
    on_hold_qty: number;
    inbound_unit_quantity: number;
  };
  warehouses: AcrossbWarehouseSummary[];
  skuRows: AcrossbSkuSummaryRow[];
  inventoryRows: AcrossbInventoryRow[];
  inboundRows: AcrossbInboundRequestRow[];
}

const ACTIVE_WAREHOUSE_CODES: AcrossbWarehouseCode[] = ["AXB-NL-DKW-1", "AXB-UK-HMI-1"];
const warehousePlaceholders = ACTIVE_WAREHOUSE_CODES.map((_, index) => `:warehouse${index}`).join(", ");
const warehouseParams = Object.fromEntries(ACTIVE_WAREHOUSE_CODES.map((code, index) => [`warehouse${index}`, code]));

function toDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (!text || text.startsWith("1970-01-01")) return null;
  return text;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  if (!text || text === "1970-01-01") return null;
  return text;
}

function num(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function trim(value: unknown) {
  return String(value ?? "").trim();
}

export async function fetchAcrossbSummary(): Promise<AcrossbSummary> {
  const [warehouseRows, inventoryRows, skuRows, inboundRows] = await Promise.all([
    fetchAcrossbWarehouses(),
    fetchAcrossbInventoryRows(),
    fetchAcrossbSkuSummaryRows(),
    fetchAcrossbInboundRows(),
  ]);

  const warehouseMeta = new Map(warehouseRows.map((row) => [row.warehouse_code, row]));
  const inboundByWarehouse = new Map<AcrossbWarehouseCode, { count: number; units: number }>();
  for (const row of inboundRows) {
    const current = inboundByWarehouse.get(row.warehouse_code) ?? { count: 0, units: 0 };
    current.count += 1;
    current.units += row.unit_quantity;
    inboundByWarehouse.set(row.warehouse_code, current);
  }

  const warehouses = ACTIVE_WAREHOUSE_CODES.map((warehouseCode) => {
    const rows = inventoryRows.filter((row) => row.warehouse_code === warehouseCode);
    const skuSet = new Set(rows.map((row) => row.sku));
    const lotSet = new Set(rows.map((row) => `${row.sku}|${row.lot_number}|${row.expiration_date ?? ""}`));
    const inbound = inboundByWarehouse.get(warehouseCode) ?? { count: 0, units: 0 };
    const meta = warehouseMeta.get(warehouseCode);
    return {
      warehouse_code: warehouseCode,
      warehouse_name: meta?.warehouse_name ?? warehouseCode,
      country_code: meta?.country_code ?? "",
      timezone: meta?.timezone ?? "",
      row_count: rows.length,
      sku_count: skuSet.size,
      lot_count: lotSet.size,
      on_hand_qty: sum(rows, "on_hand_qty"),
      available_qty: sum(rows, "available_qty"),
      on_hold_qty: sum(rows, "on_hold_qty"),
      inbound_request_count: inbound.count,
      inbound_unit_quantity: inbound.units,
      latest_inventory_updated_at: maxString(rows.map((row) => row.updated_at)),
    } satisfies AcrossbWarehouseSummary;
  });

  const allLotSet = new Set(inventoryRows.map((row) => `${row.warehouse_code}|${row.sku}|${row.lot_number}|${row.expiration_date ?? ""}`));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      warehouse_codes: ACTIVE_WAREHOUSE_CODES,
      latest_inventory_updated_at: maxString(inventoryRows.map((row) => row.updated_at)),
      warehouse_count: warehouses.filter((row) => row.row_count > 0).length,
      inventory_row_count: inventoryRows.length,
      sku_count: new Set(inventoryRows.map((row) => row.sku)).size,
      lot_count: allLotSet.size,
      inbound_request_count: inboundRows.length,
    },
    totals: {
      on_hand_qty: sum(inventoryRows, "on_hand_qty"),
      available_qty: sum(inventoryRows, "available_qty"),
      on_hold_qty: sum(inventoryRows, "on_hold_qty"),
      inbound_unit_quantity: sum(inboundRows, "unit_quantity"),
    },
    warehouses,
    skuRows,
    inventoryRows,
    inboundRows,
  };
}

async function fetchAcrossbWarehouses() {
  const rows = await queryCrewDbReadOnly<Record<string, unknown>>(
    `SELECT inventory_group_code, warehouse_code, warehouse_name, country_code, country_name, timezone
       FROM acrossb_open_api_inventory_group
      WHERE warehouse_code IN (${warehousePlaceholders})
      ORDER BY country_code, warehouse_code`,
    warehouseParams,
  );
  return rows.map((row) => ({
    inventory_group_code: trim(row.inventory_group_code) as AcrossbWarehouseCode,
    warehouse_code: trim(row.warehouse_code) as AcrossbWarehouseCode,
    warehouse_name: trim(row.warehouse_name),
    country_code: trim(row.country_code),
    country_name: trim(row.country_name),
    timezone: trim(row.timezone),
  }));
}

async function fetchAcrossbInventoryRows() {
  const rows = await queryCrewDbReadOnly<Record<string, unknown>>(
    `SELECT
        w.warehouse_name,
        w.country_code,
        i.warehouse_code,
        i.sku,
        i.name,
        i.barcode,
        i.reference_number,
        i.source_transaction_id,
        i.line_item_id,
        i.inventory_unit_of_measure,
        i.packaging_unit_of_measure,
        i.inventory_age_days,
        i.received_at,
        i.received_qty,
        i.on_hand_qty,
        i.available_qty,
        i.on_hold_qty,
        i.lot_number,
        i.expiration_date,
        i.location_code,
        i.updated_at
       FROM acrossb_open_api_wms_inventory i
       JOIN acrossb_open_api_inventory_group w
         ON w.warehouse_code = i.warehouse_code
      WHERE i.warehouse_code IN (${warehousePlaceholders})
      ORDER BY i.warehouse_code, i.sku, i.expiration_date, i.lot_number, i.reference_number`,
    warehouseParams,
  );

  return rows.map((row) => ({
    warehouse_code: trim(row.warehouse_code) as AcrossbWarehouseCode,
    warehouse_name: trim(row.warehouse_name),
    country_code: trim(row.country_code),
    sku: trim(row.sku),
    name: trim(row.name),
    barcode: trim(row.barcode),
    reference_number: trim(row.reference_number),
    source_transaction_id: trim(row.source_transaction_id),
    line_item_id: trim(row.line_item_id),
    inventory_unit_of_measure: trim(row.inventory_unit_of_measure),
    packaging_unit_of_measure: trim(row.packaging_unit_of_measure),
    inventory_age_days: row.inventory_age_days == null ? null : num(row.inventory_age_days),
    received_at: toDateTime(row.received_at as Date | string | null),
    received_qty: num(row.received_qty),
    on_hand_qty: num(row.on_hand_qty),
    available_qty: num(row.available_qty),
    on_hold_qty: num(row.on_hold_qty),
    lot_number: trim(row.lot_number),
    expiration_date: toDate(row.expiration_date as Date | string | null),
    location_code: trim(row.location_code),
    updated_at: toDateTime(row.updated_at as Date | string | null),
  }));
}

async function fetchAcrossbSkuSummaryRows() {
  const rows = await queryCrewDbReadOnly<Record<string, unknown>>(
    `SELECT
        w.warehouse_name,
        w.country_code,
        i.warehouse_code,
        i.sku,
        MIN(i.name) AS name,
        COUNT(*) AS row_count,
        COUNT(DISTINCT CONCAT(i.lot_number, '|', i.expiration_date)) AS lot_count,
        SUM(i.on_hand_qty) AS on_hand_qty,
        SUM(i.available_qty) AS available_qty,
        SUM(i.on_hold_qty) AS on_hold_qty,
        SUM(i.received_qty) AS received_qty,
        MIN(NULLIF(i.expiration_date, '1970-01-01')) AS nearest_expiration_date,
        MIN(NULLIF(i.received_at, '1970-01-01 00:00:00')) AS oldest_received_at,
        MAX(i.inventory_age_days) AS max_inventory_age_days
       FROM acrossb_open_api_wms_inventory i
       JOIN acrossb_open_api_inventory_group w
         ON w.warehouse_code = i.warehouse_code
      WHERE i.warehouse_code IN (${warehousePlaceholders})
      GROUP BY w.warehouse_name, w.country_code, i.warehouse_code, i.sku
      ORDER BY i.warehouse_code, SUM(i.available_qty) DESC, i.sku`,
    warehouseParams,
  );

  return rows.map((row) => ({
    warehouse_code: trim(row.warehouse_code) as AcrossbWarehouseCode,
    warehouse_name: trim(row.warehouse_name),
    country_code: trim(row.country_code),
    sku: trim(row.sku),
    name: trim(row.name),
    lot_count: num(row.lot_count),
    row_count: num(row.row_count),
    on_hand_qty: num(row.on_hand_qty),
    available_qty: num(row.available_qty),
    on_hold_qty: num(row.on_hold_qty),
    received_qty: num(row.received_qty),
    nearest_expiration_date: toDate(row.nearest_expiration_date as Date | string | null),
    oldest_received_at: toDateTime(row.oldest_received_at as Date | string | null),
    max_inventory_age_days: row.max_inventory_age_days == null ? null : num(row.max_inventory_age_days),
  }));
}

async function fetchAcrossbInboundRows() {
  const rows = await queryCrewDbReadOnly<Record<string, unknown>>(
    `SELECT
        r.inbound_id,
        w.warehouse_name,
        w.country_code,
        r.warehouse_code,
        r.status,
        r.transport_method,
        r.reference_number,
        r.requested_at,
        r.requested_by,
        r.expected_inbound_date,
        r.completed_inbound_date,
        r.master_bl_number,
        r.house_bl_number,
        r.master_awb_number,
        r.house_awb_number,
        COUNT(i.id) AS item_rows,
        COUNT(DISTINCT i.sku) AS sku_count,
        COALESCE(SUM(i.unit_quantity), 0) AS unit_quantity,
        COALESCE(SUM(i.carton_quantity), 0) AS carton_quantity,
        COALESCE(SUM(i.pallet_quantity), 0) AS pallet_quantity
       FROM acrossb_open_api_inbound_request r
       JOIN acrossb_open_api_inventory_group w
         ON w.warehouse_code = r.warehouse_code
       LEFT JOIN acrossb_open_api_inbound_request_item i
         ON i.inbound_id = r.inbound_id
      WHERE r.warehouse_code IN (${warehousePlaceholders})
      GROUP BY
        r.inbound_id,
        w.warehouse_name,
        w.country_code,
        r.warehouse_code,
        r.status,
        r.transport_method,
        r.reference_number,
        r.requested_at,
        r.requested_by,
        r.expected_inbound_date,
        r.completed_inbound_date,
        r.master_bl_number,
        r.house_bl_number,
        r.master_awb_number,
        r.house_awb_number
      ORDER BY r.requested_at DESC, r.reference_number`,
    warehouseParams,
  );

  return rows.map((row) => ({
    inbound_id: trim(row.inbound_id),
    warehouse_code: trim(row.warehouse_code) as AcrossbWarehouseCode,
    warehouse_name: trim(row.warehouse_name),
    country_code: trim(row.country_code),
    status: trim(row.status),
    transport_method: trim(row.transport_method),
    reference_number: trim(row.reference_number),
    requested_at: toDateTime(row.requested_at as Date | string | null),
    requested_by: trim(row.requested_by),
    expected_inbound_date: toDateTime(row.expected_inbound_date as Date | string | null),
    completed_inbound_date: toDateTime(row.completed_inbound_date as Date | string | null),
    master_bl_number: trim(row.master_bl_number),
    house_bl_number: trim(row.house_bl_number),
    master_awb_number: trim(row.master_awb_number),
    house_awb_number: trim(row.house_awb_number),
    item_rows: num(row.item_rows),
    sku_count: num(row.sku_count),
    unit_quantity: num(row.unit_quantity),
    carton_quantity: num(row.carton_quantity),
    pallet_quantity: num(row.pallet_quantity),
  }));
}

function sum<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function maxString(values: Array<string | null>) {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.sort().at(-1) ?? null : null;
}
