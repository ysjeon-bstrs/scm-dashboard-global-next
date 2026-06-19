import { createHash } from "node:crypto";

export type NumericInput = string | number | null | undefined;

export interface AmazonSalesRawRow {
  order_date_pt?: string | Date | null;
  marketplaceid?: string | null;
  country?: string | null;
  sales_channel?: string | null;
  asin?: string | null;
  resource_code?: string | null;
  resource_name?: string | null;
  order_status?: string | null;
  quantity?: NumericInput;
  order_id?: string | number | null;
  detail_id?: string | number | null;
  purchase_at?: string | Date | null;
}

export interface AmazonSalesDailyRow {
  raw_key: string;
  order_date_pt: string;
  center: string;
  marketplaceid: string;
  sales_channel: string;
  asin: string;
  resource_code: string;
  resource_name: string | null;
  qty_total: number;
  qty_shipped: number;
  qty_unshipped: number;
  source_order_count: number;
  source_detail_count: number;
  source_min_purchase_at: string | null;
  source_max_purchase_at: string | null;
  etl_run_id: string;
}

interface SalesBucket {
  order_date_pt: string;
  center: string;
  marketplaceid: string;
  sales_channel: string;
  asin: string;
  resource_code: string;
  resource_name: string | null;
  qty_total: number;
  qty_shipped: number;
  qty_unshipped: number;
  orderIds: Set<string>;
  detailIds: Set<string>;
  source_min_purchase_at: Date | null;
  source_max_purchase_at: Date | null;
}

export function resolveAmazonSalesCenter(
  marketplaceid: string | null | undefined,
  country: string | null | undefined,
  salesChannel?: string | null | undefined,
) {
  const marketplace = cleanString(marketplaceid);
  const countryCode = cleanString(country).toUpperCase();
  const channel = cleanString(salesChannel).toLowerCase();

  if (marketplace === "ATVPDKIKX0DER" || countryCode === "US") return "AMZUS";
  if (marketplace === "A1F83G8C2ARO7P" || countryCode === "UK" || channel === "amazon.co.uk") return "AMZUK";
  if (marketplace === "A1PA6795UKMFR9" || countryCode === "DE" || ["amazon.de", "amazon.fr", "amazon.es", "amazon.it"].includes(channel)) return "AMZDE";
  if (marketplace === "A2VIGQ35RCS4UG" || countryCode === "AE" || channel === "amazon.ae") return "AMZAE";

  return null;
}

export function buildAmazonSalesRawKey(input: Pick<AmazonSalesDailyRow, "order_date_pt" | "center" | "marketplaceid" | "sales_channel" | "asin" | "resource_code">) {
  return createHash("sha256")
    .update([
      input.order_date_pt,
      input.center,
      input.marketplaceid,
      input.sales_channel,
      input.asin,
      input.resource_code,
    ].join("|"))
    .digest("base64url");
}

export function transformAmazonSalesRows(
  rawRows: AmazonSalesRawRow[],
  etlRunId: string,
): AmazonSalesDailyRow[] {
  const buckets = new Map<string, SalesBucket>();

  for (const row of rawRows) {
    const orderDate = normalizeDate(row.order_date_pt);
    const marketplaceid = cleanString(row.marketplaceid);
    const salesChannel = cleanString(row.sales_channel);
    const center = resolveAmazonSalesCenter(marketplaceid, row.country, salesChannel);
    const asin = cleanString(row.asin);
    const resourceCode = cleanString(row.resource_code);

    if (!orderDate || !marketplaceid || !center || !asin || !resourceCode) continue;

    const key = [orderDate, center, marketplaceid, salesChannel, asin, resourceCode].join("||");
    const bucket = buckets.get(key) ?? {
      order_date_pt: orderDate,
      center,
      marketplaceid,
      sales_channel: salesChannel,
      asin,
      resource_code: resourceCode,
      resource_name: cleanString(row.resource_name) || null,
      qty_total: 0,
      qty_shipped: 0,
      qty_unshipped: 0,
      orderIds: new Set<string>(),
      detailIds: new Set<string>(),
      source_min_purchase_at: null,
      source_max_purchase_at: null,
    };

    const qty = toNumber(row.quantity);
    bucket.qty_total += qty;
    if (isUnshipped(row.order_status)) bucket.qty_unshipped += qty;
    else bucket.qty_shipped += qty;
    if (!bucket.resource_name) bucket.resource_name = cleanString(row.resource_name) || null;

    const orderId = cleanString(row.order_id);
    const detailId = cleanString(row.detail_id);
    if (orderId) bucket.orderIds.add(orderId);
    if (detailId) bucket.detailIds.add(detailId);

    const purchaseAt = toDate(row.purchase_at);
    if (purchaseAt && (!bucket.source_min_purchase_at || purchaseAt < bucket.source_min_purchase_at)) {
      bucket.source_min_purchase_at = purchaseAt;
    }
    if (purchaseAt && (!bucket.source_max_purchase_at || purchaseAt > bucket.source_max_purchase_at)) {
      bucket.source_max_purchase_at = purchaseAt;
    }

    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const withoutKey = {
        order_date_pt: bucket.order_date_pt,
        center: bucket.center,
        marketplaceid: bucket.marketplaceid,
        sales_channel: bucket.sales_channel,
        asin: bucket.asin,
        resource_code: bucket.resource_code,
        resource_name: bucket.resource_name,
        qty_total: bucket.qty_total,
        qty_shipped: bucket.qty_shipped,
        qty_unshipped: bucket.qty_unshipped,
        source_order_count: bucket.orderIds.size,
        source_detail_count: bucket.detailIds.size,
        source_min_purchase_at: bucket.source_min_purchase_at?.toISOString() ?? null,
        source_max_purchase_at: bucket.source_max_purchase_at?.toISOString() ?? null,
        etl_run_id: etlRunId,
      };
      return {
        raw_key: buildAmazonSalesRawKey(withoutKey),
        ...withoutKey,
      };
    })
    .sort((a, b) =>
      `${a.order_date_pt}|${a.center}|${a.resource_code}|${a.asin}`.localeCompare(
        `${b.order_date_pt}|${b.center}|${b.resource_code}|${b.asin}`,
      ),
    );
}

function isUnshipped(status: string | null | undefined) {
  const normalized = cleanString(status).toLowerCase();
  return normalized === "unshipped" || normalized === "pending";
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = cleanString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value: NumericInput) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
