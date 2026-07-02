import { createHash } from "node:crypto";

export type NumericInput = string | number | null | undefined;

export interface DomesticStockRawRow {
  standard_date?: string | Date | null;
  product_code?: string | null;
  product_name?: string | null;
  barcode?: string | null;
  lot?: string | null;
  expiration_date?: string | Date | null;
  warehouse_lname?: string | null;
  location?: string | null;
  stock_quantity?: NumericInput;
  delivery_wait_quantity?: NumericInput;
  available_stock_quantity?: NumericInput;
}

export interface DomesticBucketMapping {
  warehouse_code: string;
  source_warehouse_lname: string;
  bucket_code: string;
  bucket_name?: string | null;
  include_in_running_stock: boolean;
}

export interface DomesticRawSnapshotUpsertRow {
  source_raw_key: string;
  snapshot_date: string;
  warehouse_code: string;
  source_system: string;
  product_code: string;
  product_name: string | null;
  barcode: string | null;
  lot: string;
  expiration_date: string | null;
  warehouse_lname: string;
  location: string;
  stock_quantity: number;
  delivery_wait_quantity: number;
  available_stock_quantity: number;
  etl_run_id: string;
}

export interface DomesticLotSnapshotUpsertRow {
  raw_key: string;
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
  product_name: string | null;
  barcode: string | null;
  lot: string;
  expiration_date: string | null;
  warehouse_lname: string;
  location: string;
  bucket_code: string;
  bucket_name: string | null;
  include_in_running_stock: boolean;
  stock_quantity: number;
  delivery_wait_quantity: number;
  available_stock_quantity: number;
  etl_run_id: string;
}

export interface DomesticSkuSnapshotUpsertRow {
  raw_key: string;
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
  product_name: string | null;
  stock_running: number;
  stock_total: number;
  stock_excluded: number;
  available_running: number;
  delivery_wait_quantity: number;
  lot_count: number;
  nearest_expiration_date: string | null;
  etl_run_id: string;
}

export interface DomesticStockTransformResult {
  rawRows: DomesticRawSnapshotUpsertRow[];
  lotRows: DomesticLotSnapshotUpsertRow[];
  skuRows: DomesticSkuSnapshotUpsertRow[];
  summary: DomesticStockTransformSummary;
}

export interface DomesticStockTransformSummary {
  snapshot_date: string;
  warehouse_code: string;
  sourceRows: number;
  rawRows: number;
  baRows: number;
  baSkuCount: number;
  stockQuantityTotal: number;
  availableStockQuantityTotal: number;
  deliveryWaitQuantityTotal: number;
  runningStockTotal: number;
  runningSkuCount: number;
  excludedStockTotal: number;
  bucketTotals: Record<string, { rows: number; stock_quantity: number; include_in_running_stock: boolean }>;
}

interface TransformOptions {
  warehouseCode?: string;
  sourceSystem?: string;
  etlRunId?: string;
  baOnlyForMart?: boolean;
  bucketMappings?: DomesticBucketMapping[];
}

const DEFAULT_WAREHOUSE_CODE = "DESIGN_KR";
const DEFAULT_SOURCE_SYSTEM = "nansoft";
const DEFAULT_ETL_RUN_ID = "dry-run";
const UNKNOWN_BUCKET_CODE = "unmapped";

export const DEFAULT_DESIGN_KR_BUCKET_MAPPINGS: DomesticBucketMapping[] = [
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "DL_입고",
    bucket_code: "design_inbound",
    bucket_name: "디자인로지스 입고완료",
    include_in_running_stock: true,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "임시(부스터스)",
    bucket_code: "temporary_boosters",
    bucket_name: "임시(부스터스)",
    include_in_running_stock: false,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "입고_대기",
    bucket_code: "inbound_waiting",
    bucket_name: "입고 대기",
    include_in_running_stock: false,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "글로벌_B2B_KEEPING",
    bucket_code: "legacy_b2b_keeping",
    bucket_name: "기존 B2B keeping",
    include_in_running_stock: false,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "분실창고",
    bucket_code: "lost",
    bucket_name: "분실창고",
    include_in_running_stock: false,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "불량창고",
    bucket_code: "defective",
    bucket_name: "불량창고",
    include_in_running_stock: false,
  },
  {
    warehouse_code: DEFAULT_WAREHOUSE_CODE,
    source_warehouse_lname: "폐기창고",
    bucket_code: "disposal",
    bucket_name: "폐기창고",
    include_in_running_stock: false,
  },
];

export function buildDomesticStockRawKey(input: {
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
  lot: string;
  expiration_date: string | null;
  warehouse_lname: string;
  location: string;
}) {
  return hashKey([
    input.snapshot_date,
    input.warehouse_code,
    input.product_code,
    input.lot,
    input.expiration_date ?? "",
    input.warehouse_lname,
    input.location,
  ]);
}

export function buildDomesticStockSkuKey(input: {
  snapshot_date: string;
  warehouse_code: string;
  product_code: string;
}) {
  return hashKey([input.snapshot_date, input.warehouse_code, input.product_code]);
}

export function transformDomesticStockRows(
  sourceRows: DomesticStockRawRow[],
  options: TransformOptions = {},
): DomesticStockTransformResult {
  const warehouseCode = options.warehouseCode ?? DEFAULT_WAREHOUSE_CODE;
  const sourceSystem = options.sourceSystem ?? DEFAULT_SOURCE_SYSTEM;
  const etlRunId = options.etlRunId ?? DEFAULT_ETL_RUN_ID;
  const baOnlyForMart = options.baOnlyForMart ?? true;
  const bucketMappings = options.bucketMappings ?? DEFAULT_DESIGN_KR_BUCKET_MAPPINGS;
  const bucketMap = new Map(
    bucketMappings
      .filter((mapping) => mapping.warehouse_code === warehouseCode)
      .map((mapping) => [mapping.source_warehouse_lname, mapping]),
  );

  const rawRows: DomesticRawSnapshotUpsertRow[] = [];
  const lotAgg = new Map<string, DomesticLotSnapshotUpsertRow>();

  for (const row of sourceRows) {
    const snapshotDate = toYmd(row.standard_date);
    const productCode = cleanString(row.product_code);
    const lot = cleanString(row.lot);
    const warehouseLname = cleanString(row.warehouse_lname);
    const location = cleanString(row.location);
    const stockQuantity = toNumber(row.stock_quantity);

    if (!snapshotDate || !productCode || !lot || !warehouseLname || stockQuantity <= 0) {
      continue;
    }

    const expirationDate = toYmd(row.expiration_date);
    const raw: DomesticRawSnapshotUpsertRow = {
      source_raw_key: buildDomesticStockRawKey({
        snapshot_date: snapshotDate,
        warehouse_code: warehouseCode,
        product_code: productCode,
        lot,
        expiration_date: expirationDate,
        warehouse_lname: warehouseLname,
        location,
      }),
      snapshot_date: snapshotDate,
      warehouse_code: warehouseCode,
      source_system: sourceSystem,
      product_code: productCode,
      product_name: nullableString(row.product_name),
      barcode: nullableString(row.barcode),
      lot,
      expiration_date: expirationDate,
      warehouse_lname: warehouseLname,
      location,
      stock_quantity: stockQuantity,
      delivery_wait_quantity: toNumber(row.delivery_wait_quantity),
      available_stock_quantity: toNumber(row.available_stock_quantity),
      etl_run_id: etlRunId,
    };
    rawRows.push(raw);

    if (baOnlyForMart && !productCode.startsWith("BA")) continue;

    const mapping = bucketMap.get(warehouseLname);
    const lotKey = raw.source_raw_key;
    const existing = lotAgg.get(lotKey);
    if (existing) {
      existing.stock_quantity += raw.stock_quantity;
      existing.delivery_wait_quantity += raw.delivery_wait_quantity;
      existing.available_stock_quantity += raw.available_stock_quantity;
    } else {
      lotAgg.set(lotKey, {
        raw_key: lotKey,
        snapshot_date: raw.snapshot_date,
        warehouse_code: raw.warehouse_code,
        product_code: raw.product_code,
        product_name: raw.product_name,
        barcode: raw.barcode,
        lot: raw.lot,
        expiration_date: raw.expiration_date,
        warehouse_lname: raw.warehouse_lname,
        location: raw.location,
        bucket_code: mapping?.bucket_code ?? UNKNOWN_BUCKET_CODE,
        bucket_name: mapping?.bucket_name ?? null,
        include_in_running_stock: mapping?.include_in_running_stock ?? false,
        stock_quantity: raw.stock_quantity,
        delivery_wait_quantity: raw.delivery_wait_quantity,
        available_stock_quantity: raw.available_stock_quantity,
        etl_run_id: raw.etl_run_id,
      });
    }
  }

  const lotRows = Array.from(lotAgg.values()).sort((a, b) =>
    `${a.snapshot_date}|${a.product_code}|${a.expiration_date ?? ""}|${a.lot}|${a.warehouse_lname}|${a.location}`.localeCompare(
      `${b.snapshot_date}|${b.product_code}|${b.expiration_date ?? ""}|${b.lot}|${b.warehouse_lname}|${b.location}`,
    ),
  );
  const skuRows = buildSkuRows(lotRows, etlRunId);

  return {
    rawRows: rawRows.sort((a, b) => a.source_raw_key.localeCompare(b.source_raw_key)),
    lotRows,
    skuRows,
    summary: summarizeDomesticStock(sourceRows.length, rawRows, lotRows, skuRows, warehouseCode),
  };
}

function buildSkuRows(lotRows: DomesticLotSnapshotUpsertRow[], etlRunId: string) {
  const bySku = new Map<string, DomesticSkuSnapshotUpsertRow & { expirationDates: Set<string>; lotKeys: Set<string> }>();

  for (const row of lotRows) {
    const key = `${row.snapshot_date}|${row.warehouse_code}|${row.product_code}`;
    const existing = bySku.get(key);
    const current =
      existing ??
      {
        raw_key: buildDomesticStockSkuKey({
          snapshot_date: row.snapshot_date,
          warehouse_code: row.warehouse_code,
          product_code: row.product_code,
        }),
        snapshot_date: row.snapshot_date,
        warehouse_code: row.warehouse_code,
        product_code: row.product_code,
        product_name: row.product_name,
        stock_running: 0,
        stock_total: 0,
        stock_excluded: 0,
        available_running: 0,
        delivery_wait_quantity: 0,
        lot_count: 0,
        nearest_expiration_date: null,
        etl_run_id: etlRunId,
        expirationDates: new Set<string>(),
        lotKeys: new Set<string>(),
      };

    current.stock_total += row.stock_quantity;
    current.delivery_wait_quantity += row.delivery_wait_quantity;
    current.lotKeys.add(`${row.lot}|${row.expiration_date ?? ""}`);
    // Nearest expiry considers every lot with stock — excluded buckets
    // (임시/대기 등) are still physical stock, and an expiring lot there must
    // not be invisible just because it doesn't count as 운영재고.
    if (row.expiration_date) current.expirationDates.add(row.expiration_date);

    if (row.include_in_running_stock) {
      current.stock_running += row.stock_quantity;
      current.available_running += row.available_stock_quantity;
    } else {
      current.stock_excluded += row.stock_quantity;
    }

    bySku.set(key, current);
  }

  return Array.from(bySku.values())
    .map(({ expirationDates, lotKeys, ...row }) => ({
      ...row,
      lot_count: lotKeys.size,
      nearest_expiration_date: Array.from(expirationDates).sort()[0] ?? null,
    }))
    .sort((a, b) => `${a.snapshot_date}|${a.product_code}`.localeCompare(`${b.snapshot_date}|${b.product_code}`));
}

function summarizeDomesticStock(
  sourceRows: number,
  rawRows: DomesticRawSnapshotUpsertRow[],
  lotRows: DomesticLotSnapshotUpsertRow[],
  skuRows: DomesticSkuSnapshotUpsertRow[],
  warehouseCode: string,
): DomesticStockTransformSummary {
  const baLotRows = lotRows;
  const bucketTotals: DomesticStockTransformSummary["bucketTotals"] = {};
  for (const row of baLotRows) {
    bucketTotals[row.warehouse_lname] ??= {
      rows: 0,
      stock_quantity: 0,
      include_in_running_stock: row.include_in_running_stock,
    };
    bucketTotals[row.warehouse_lname].rows += 1;
    bucketTotals[row.warehouse_lname].stock_quantity += row.stock_quantity;
  }

  return {
    snapshot_date: rawRows.map((row) => row.snapshot_date).sort().at(-1) ?? "",
    warehouse_code: warehouseCode,
    sourceRows,
    rawRows: rawRows.length,
    baRows: lotRows.length,
    baSkuCount: new Set(lotRows.map((row) => row.product_code)).size,
    stockQuantityTotal: lotRows.reduce((sum, row) => sum + row.stock_quantity, 0),
    availableStockQuantityTotal: lotRows.reduce((sum, row) => sum + row.available_stock_quantity, 0),
    deliveryWaitQuantityTotal: lotRows.reduce((sum, row) => sum + row.delivery_wait_quantity, 0),
    runningStockTotal: skuRows.reduce((sum, row) => sum + row.stock_running, 0),
    runningSkuCount: skuRows.filter((row) => row.stock_running > 0).length,
    excludedStockTotal: skuRows.reduce((sum, row) => sum + row.stock_excluded, 0),
    bucketTotals,
  };
}

function hashKey(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("base64url");
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function nullableString(value: unknown) {
  const text = cleanString(value);
  return text ? text : null;
}

function toNumber(value: NumericInput) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function toYmd(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = cleanString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return null;
}
