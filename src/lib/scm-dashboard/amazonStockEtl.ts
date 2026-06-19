import { createHash } from "node:crypto";

export type NumericInput = string | number | null | undefined;

export interface AmazonInventoryRawRow {
  marketplaceid?: string | null;
  country?: string | null;
  resource_code?: string | null;
  source_row_count?: NumericInput;
  source_max_id?: NumericInput;
  fulfillable_quantity?: NumericInput;
  pending_transshipment_quantity?: NumericInput;
  inbound_shipped_quantity?: NumericInput;
  inbound_receiving_quantity?: NumericInput;
  inbound_working_quantity?: NumericInput;
  pending_customer_order_quantity?: NumericInput;
  fc_processing_quantity?: NumericInput;
  asin_list?: string | null;
  latest_updated_at?: string | Date | null;
}

export interface AmzStockUpsertRow {
  raw_key: string;
  resource_code: string;
  center: string;
  date: string;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  fc_processing: number;
  latest_updated_at: string | null;
  source_row_count?: number;
  source_max_id?: number | null;
}

interface AmzStockKeyInput {
  resource_code: string;
  center: string;
  date: string;
}

interface AggregationBucket {
  resource_code: string;
  center: string;
  date: string;
  stock_available: number;
  pending_fc: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  fc_processing: number;
  latest_updated_at: Date | null;
  source_row_count: number;
  source_max_id: number | null;
}

export function resolveAmazonCenter(
  marketplaceid: string | null | undefined,
  country: string | null | undefined,
) {
  const marketplace = cleanString(marketplaceid);
  const countryCode = cleanString(country).toUpperCase();

  if (marketplace === "ATVPDKIKX0DER" || countryCode === "US") return "AMZUS";
  if (marketplace === "A1F83G8C2ARO7P" || countryCode === "UK") return "AMZUK";
  if (marketplace === "A1PA6795UKMFR9" || countryCode === "DE") return "AMZDE";
  if (marketplace === "A2VIGQ35RCS4UG" || countryCode === "AE") return "AMZAE";

  return null;
}

export function buildAmzStockRawKey(input: AmzStockKeyInput) {
  const base = [input.resource_code || "", input.center || "", input.date || ""].join(
    "|",
  );
  return createHash("sha256").update(base).digest("base64url");
}

export function transformAmazonInventoryRows(
  rawRows: AmazonInventoryRawRow[],
  snapshotDate: string,
): AmzStockUpsertRow[] {
  const dedup = new Map<string, AggregationBucket>();

  for (const row of rawRows) {
    const resourceCode = cleanString(row.resource_code);
    const center = resolveAmazonCenter(row.marketplaceid, row.country);

    if (!resourceCode || !center || !snapshotDate) {
      continue;
    }

    const key = `${center}||${resourceCode}`;
    const bucket =
      dedup.get(key) ??
      {
        resource_code: resourceCode,
        center,
        date: snapshotDate,
        stock_available: 0,
        pending_fc: 0,
        stock_expected: 0,
        stock_processing: 0,
        stock_readytoship: 0,
        customer_order: 0,
        fc_processing: 0,
        latest_updated_at: null,
        source_row_count: 0,
        source_max_id: null,
      };

    bucket.stock_available += toNumber(row.fulfillable_quantity);
    bucket.pending_fc += toNumber(row.pending_transshipment_quantity);
    bucket.stock_expected += toNumber(row.inbound_shipped_quantity);
    bucket.stock_processing += toNumber(row.inbound_receiving_quantity);
    bucket.stock_readytoship += toNumber(row.inbound_working_quantity);
    bucket.customer_order += toNumber(row.pending_customer_order_quantity);
    bucket.fc_processing += toNumber(row.fc_processing_quantity);
    bucket.source_row_count += toNumber(row.source_row_count) || 1;
    const sourceMaxId = toNullableNumber(row.source_max_id);
    if (sourceMaxId !== null && (bucket.source_max_id === null || sourceMaxId > bucket.source_max_id)) {
      bucket.source_max_id = sourceMaxId;
    }

    const updatedAt = toDate(row.latest_updated_at);
    if (updatedAt && (!bucket.latest_updated_at || updatedAt > bucket.latest_updated_at)) {
      bucket.latest_updated_at = updatedAt;
    }

    dedup.set(key, bucket);
  }

  return Array.from(dedup.values())
    .map((bucket) => ({
      raw_key: buildAmzStockRawKey(bucket),
      resource_code: bucket.resource_code,
      center: bucket.center,
      date: bucket.date,
      stock_sellable: bucket.stock_available + bucket.pending_fc,
      stock_available: bucket.stock_available,
      pending_fc: bucket.pending_fc,
      stock_expected: bucket.stock_expected,
      stock_processing: bucket.stock_processing,
      stock_readytoship: bucket.stock_readytoship,
      customer_order: bucket.customer_order,
      fc_processing: bucket.fc_processing,
      latest_updated_at: bucket.latest_updated_at?.toISOString() ?? null,
      source_row_count: bucket.source_row_count,
      source_max_id: bucket.source_max_id,
    }))
    .sort((a, b) =>
      `${a.center}|${a.resource_code}`.localeCompare(`${b.center}|${b.resource_code}`),
    );
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: NumericInput) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;

  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function toNullableNumber(value: NumericInput) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
