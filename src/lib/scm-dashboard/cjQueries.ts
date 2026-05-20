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
  };
}

interface FetchCjLotStockOptions {
  limit: number;
  sku?: string | null;
  depot?: string | null;
  latestOnly: boolean;
}

export async function fetchCjLotStocks({
  limit,
  sku,
  depot,
  latestOnly,
}: FetchCjLotStockOptions) {
  const tableName = getSafeMysqlIdentifier("SCM_MYSQL_CJ_STOCK_TABLE", "cj_stock");
  const where: string[] = [];
  const params: Record<string, string | number> = { limit };

  if (latestOnly) {
    where.push(`closeDt = (SELECT MAX(closeDt) FROM ${tableName})`);
  }

  if (sku) {
    where.push("prodCd = :sku");
    params.sku = sku;
  }

  if (depot) {
    where.push("depotCd = :depot");
    params.depot = depot;
  }

  const sql = `
    SELECT
      created_at,
      updated_at,
      closeDt,
      depotCd,
      prodLotNo,
      prodDt,
      ValidDim,
      prodCd,
      ProdNm,
      prodBrcd,
      stockCnt,
      avlbCnt,
      holdCnt,
      allocCnt
    FROM ${tableName}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY prodCd ASC, ValidDim ASC, prodLotNo ASC
    LIMIT :limit
  `;

  const rows = await queryBoostersScmReadOnly<CjLotStockDbRow>(sql, params);
  return {
    tableName,
    rows: rows.map(mapCjLotStockRow),
  };
}
