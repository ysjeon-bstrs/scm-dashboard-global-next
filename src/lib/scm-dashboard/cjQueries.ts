import { queryBoostersScmReadOnly } from "./mysqlPools";
import { getSafeMysqlIdentifier } from "./sql";
import type { CjLotStockDbRow, CjLotStockRow } from "./cjTypes";

function toDateString(value: Date | string | null) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toDateTimeString(value: Date | string | null) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toNullableYmd(value: string | null) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text || text === "\\N") return null;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text;
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function mapCjLotStockRow(row: CjLotStockDbRow): CjLotStockRow {
  return {
    created_at: toDateTimeString(row.created_at),
    updated_at: toDateTimeString(row.updated_at),
    close_date: toDateString(row.closeDt),
    depot_code: row.depotCd,
    lot_no: row.prodLotNo,
    production_date: toNullableYmd(row.prodDt),
    expiration_date: toNullableYmd(row.ValidDim),
    resource_code: row.prodCd,
    resource_name: row.ProdNm,
    barcode: row.prodBrcd,
    stock_qty: toNumber(row.stockCnt),
    available_qty: toNumber(row.avlbCnt),
    hold_qty: toNumber(row.holdCnt),
    allocated_qty: toNumber(row.allocCnt),
    units_per_box: toNullableNumber(row.box_count),
    boxes_per_pallet: toNullableNumber(row.full_pallet_box_count),
    units_per_pallet: toNullableNumber(row.pallet_load_count),
  };
}

interface FetchCjLotStockOptions {
  limit: number;
  sku?: string | null;
  skus?: string[];
  depot?: string | null;
  latestOnly: boolean;
}

export async function fetchCjLotStocks({
  limit,
  sku,
  skus,
  depot,
  latestOnly,
}: FetchCjLotStockOptions) {
  const tableName = getSafeMysqlIdentifier("SCM_MYSQL_CJ_STOCK_TABLE", "cj_stock");
  const masterTable = getSafeMysqlIdentifier(
    "SCM_MYSQL_ITEM_MASTER_TABLE",
    "scm_global_move_master_item",
  );
  const where: string[] = [];
  const params: Record<string, string | number> = { limit };

  if (latestOnly) {
    where.push(`s.closeDt = (SELECT MAX(closeDt) FROM ${tableName})`);
  }

  if (sku) {
    where.push("s.prodCd = :sku");
    params.sku = sku;
  }

  const uniqueSkus = Array.from(
    new Set((skus ?? []).map((value) => value.trim()).filter(Boolean)),
  );
  if (!sku && uniqueSkus.length > 0) {
    const placeholders = uniqueSkus.map((_, index) => `:sku${index}`);
    where.push(`s.prodCd IN (${placeholders.join(", ")})`);
    uniqueSkus.forEach((value, index) => {
      params[`sku${index}`] = value;
    });
  }

  if (depot) {
    where.push("s.depotCd = :depot");
    params.depot = depot;
  }

  const sql = `
    SELECT
      s.created_at,
      s.updated_at,
      s.closeDt,
      s.depotCd,
      s.prodLotNo,
      s.prodDt,
      s.ValidDim,
      s.prodCd,
      s.ProdNm,
      s.prodBrcd,
      s.stockCnt,
      s.avlbCnt,
      s.holdCnt,
      s.allocCnt,
      m.box_count,
      m.full_pallet_box_count,
      m.pallet_load_count
    FROM ${tableName} s
    LEFT JOIN ${masterTable} m
      ON m.product_code COLLATE utf8mb4_unicode_ci
       = s.prodCd COLLATE utf8mb4_unicode_ci
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY s.prodCd ASC, s.ValidDim ASC, s.prodLotNo ASC
    LIMIT :limit
  `;

  const rows = await queryBoostersScmReadOnly<CjLotStockDbRow>(sql, params);
  return {
    tableName,
    rows: rows.map(mapCjLotStockRow),
  };
}

export interface CjStockOverview {
  close_date: string | null;
  lot_count: number;
  sku_count: number;
  depot_count: number;
  available_qty: number;
  expiry_risk_count: number;
}

// Aggregate KPIs for the overview page, computed in SQL over the full latest
// snapshot — a row-limited fetch would silently understate the totals.
export async function fetchCjStockOverview(): Promise<CjStockOverview> {
  const tableName = getSafeMysqlIdentifier("SCM_MYSQL_CJ_STOCK_TABLE", "cj_stock");
  const sql = `
    SELECT
      MAX(s.closeDt) AS close_date,
      COUNT(*) AS lot_count,
      COUNT(DISTINCT s.prodCd) AS sku_count,
      COUNT(DISTINCT s.depotCd) AS depot_count,
      COALESCE(SUM(s.avlbCnt), 0) AS available_qty,
      COALESCE(SUM(
        CASE
          WHEN STR_TO_DATE(REPLACE(s.ValidDim, '-', ''), '%Y%m%d')
               < DATE_ADD(CURDATE(), INTERVAL 365 DAY) THEN 1
          ELSE 0
        END
      ), 0) AS expiry_risk_count
    FROM ${tableName} s
    WHERE s.closeDt = (SELECT MAX(closeDt) FROM ${tableName})
  `;

  const rows = await queryBoostersScmReadOnly<{
    close_date: Date | string | null;
    lot_count: unknown;
    sku_count: unknown;
    depot_count: unknown;
    available_qty: unknown;
    expiry_risk_count: unknown;
  }>(sql);
  const row = rows[0];
  return {
    close_date: row?.close_date ? toDateString(row.close_date) : null,
    lot_count: toNumber(row?.lot_count),
    sku_count: toNumber(row?.sku_count),
    depot_count: toNumber(row?.depot_count),
    available_qty: toNumber(row?.available_qty),
    expiry_risk_count: toNumber(row?.expiry_risk_count),
  };
}
