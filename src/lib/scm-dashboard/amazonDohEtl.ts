import { createHash } from "node:crypto";

export interface AmazonDohInventoryInput {
  snapshot_date: string;
  center: string;
  resource_code: string;
  resource_name?: string | null;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
}

export interface AmazonDohSalesInput {
  order_date_pt: string;
  center: string;
  resource_code: string;
  resource_name?: string | null;
  qty_total: number;
}

export type AmazonDohStatus =
  | "CRITICAL_SEND_NOW"
  | "SEND_SOON"
  | "WATCH_INCOMING"
  | "WATCH"
  | "OK"
  | "NO_SALES";

export interface AmazonDohRow {
  raw_key: string;
  snapshot_date: string;
  sales_window_end_date: string;
  center: string;
  resource_code: string;
  resource_name: string | null;
  stock_sellable: number;
  stock_available: number;
  pending_fc: number;
  stock_incoming: number;
  stock_expected: number;
  stock_processing: number;
  stock_readytoship: number;
  customer_order: number;
  qty_1d: number;
  qty_7d: number;
  qty_30d: number;
  qty_90d: number;
  vel_7d: number;
  vel_30d: number;
  vel_90d: number;
  doh_7d: number;
  doh_30d: number;
  doh_90d: number;
  target_days: number;
  warn_days: number;
  danger_days: number;
  fee_risk_days: number;
  required_qty_gross: number;
  required_qty_net: number;
  recommended_ship_qty: number;
  gap_45d: number;
  status: AmazonDohStatus;
  fee_risk: boolean;
  urgency_rank: number;
  action_label: string;
  action_reason: string;
  etl_run_id: string;
}

export interface AmazonDohConfig {
  targetDays: number;
  warnDays: number;
  dangerDays: number;
  feeRiskDays: number;
  dohMaxDays: number;
  excludeSkus: Set<string>;
  feeRiskExcludeSkus: Set<string>;
  feeRiskExcludeCenters: Set<string>;
}

export const DEFAULT_AMAZON_DOH_CONFIG: AmazonDohConfig = {
  targetDays: 45,
  warnDays: 40,
  dangerDays: 35,
  feeRiskDays: 28,
  dohMaxDays: 999,
  excludeSkus: new Set(["BA00030"]),
  feeRiskExcludeSkus: new Set(["BA00059_SET01", "BA00061", "BA00022_SET01"]),
  feeRiskExcludeCenters: new Set(["AMZDE", "AMZUK", "AMZAE"]),
};

export function getAmazonDohSalesWindowEnd(snapshotDate: string) {
  return addDays(snapshotDate, -1);
}

export function buildAmazonDohRawKey(input: Pick<AmazonDohRow, "snapshot_date" | "center" | "resource_code">) {
  return createHash("sha256")
    .update([input.snapshot_date, input.center, input.resource_code].join("|"))
    .digest("base64url");
}

export function buildAmazonDohRows({
  inventory,
  sales,
  snapshotDate,
  etlRunId,
  config = DEFAULT_AMAZON_DOH_CONFIG,
}: {
  inventory: AmazonDohInventoryInput[];
  sales: AmazonDohSalesInput[];
  snapshotDate: string;
  etlRunId: string;
  config?: AmazonDohConfig;
}): AmazonDohRow[] {
  const salesWindowEnd = getAmazonDohSalesWindowEnd(snapshotDate);
  const salesByKeyDate = buildSalesIndex(sales);
  const salesNameByKey = buildSalesNameIndex(sales);
  const rows: AmazonDohRow[] = [];

  for (const item of inventory) {
    const resourceCode = cleanString(item.resource_code);
    const center = cleanString(item.center);
    if (!resourceCode || !center) continue;
    if (config.excludeSkus.has(resourceCode)) continue;

    const key = `${center}||${resourceCode}`;
    const qty1d = sumCalendarSales(salesByKeyDate, key, salesWindowEnd, 1);
    const qty7d = sumCalendarSales(salesByKeyDate, key, salesWindowEnd, 7);
    const qty30d = sumCalendarSales(salesByKeyDate, key, salesWindowEnd, 30);
    const qty90d = sumCalendarSales(salesByKeyDate, key, salesWindowEnd, 90);
    const vel7 = round(qty7d / 7, 4);
    const vel30 = round(qty30d / 30, 4);
    const vel90 = round(qty90d / 90, 4);
    const stockSellable = nonNegative(item.stock_sellable);
    const stockAvailable = nonNegative(item.stock_available);
    const pendingFc = nonNegative(item.pending_fc);
    const stockExpected = nonNegative(item.stock_expected);
    const stockProcessing = nonNegative(item.stock_processing);
    const stockReadyToShip = nonNegative(item.stock_readytoship);
    const stockIncoming = stockExpected + stockProcessing + stockReadyToShip;
    const requiredGross = Math.max(0, Math.ceil(config.targetDays * vel7 - stockSellable));
    const requiredNet = Math.max(0, Math.ceil(config.targetDays * vel7 - stockSellable - stockIncoming));
    const gap45d = Math.round(stockSellable + stockIncoming - vel7 * config.targetDays);
    const doh7 = calculateDoh(stockSellable, vel7, config.dohMaxDays);
    const doh30 = calculateDoh(stockSellable, vel30, config.dohMaxDays);
    const doh90 = calculateDoh(stockSellable, vel90, config.dohMaxDays);
    const feeRisk =
      !config.feeRiskExcludeSkus.has(resourceCode) &&
      !config.feeRiskExcludeCenters.has(center) &&
      doh30 < config.feeRiskDays &&
      doh90 < config.feeRiskDays;
    const decision = decideAction({
      doh7,
      vel7,
      requiredNet,
      stockIncoming,
      config,
    });

    const withoutKey = {
      snapshot_date: snapshotDate,
      sales_window_end_date: salesWindowEnd,
      center,
      resource_code: resourceCode,
      resource_name: cleanString(item.resource_name) || salesNameByKey.get(key) || null,
      stock_sellable: stockSellable,
      stock_available: stockAvailable,
      pending_fc: pendingFc,
      stock_incoming: stockIncoming,
      stock_expected: stockExpected,
      stock_processing: stockProcessing,
      stock_readytoship: stockReadyToShip,
      customer_order: nonNegative(item.customer_order),
      qty_1d: qty1d,
      qty_7d: qty7d,
      qty_30d: qty30d,
      qty_90d: qty90d,
      vel_7d: vel7,
      vel_30d: vel30,
      vel_90d: vel90,
      doh_7d: doh7,
      doh_30d: doh30,
      doh_90d: doh90,
      target_days: config.targetDays,
      warn_days: config.warnDays,
      danger_days: config.dangerDays,
      fee_risk_days: config.feeRiskDays,
      required_qty_gross: requiredGross,
      required_qty_net: requiredNet,
      recommended_ship_qty: requiredNet,
      gap_45d: gap45d,
      status: decision.status,
      fee_risk: feeRisk,
      urgency_rank: decision.urgencyRank,
      action_label: decision.actionLabel,
      action_reason: decision.actionReason,
      etl_run_id: etlRunId,
    } satisfies Omit<AmazonDohRow, "raw_key">;

    rows.push({
      raw_key: buildAmazonDohRawKey(withoutKey),
      ...withoutKey,
    });
  }

  return rows.sort((a, b) =>
    a.urgency_rank - b.urgency_rank ||
    b.required_qty_net - a.required_qty_net ||
    a.doh_7d - b.doh_7d ||
    `${a.center}|${a.resource_code}`.localeCompare(`${b.center}|${b.resource_code}`),
  );
}

function buildSalesIndex(sales: AmazonDohSalesInput[]) {
  const index = new Map<string, number>();
  for (const row of sales) {
    const date = normalizeDate(row.order_date_pt);
    const center = cleanString(row.center);
    const resourceCode = cleanString(row.resource_code);
    if (!date || !center || !resourceCode) continue;
    const key = `${center}||${resourceCode}||${date}`;
    index.set(key, (index.get(key) ?? 0) + nonNegative(row.qty_total));
  }
  return index;
}

function buildSalesNameIndex(sales: AmazonDohSalesInput[]) {
  const index = new Map<string, string>();
  for (const row of sales) {
    const center = cleanString(row.center);
    const resourceCode = cleanString(row.resource_code);
    const resourceName = cleanString(row.resource_name);
    if (!center || !resourceCode || !resourceName) continue;
    const key = `${center}||${resourceCode}`;
    if (!index.has(key)) index.set(key, resourceName);
  }
  return index;
}

function sumCalendarSales(
  index: Map<string, number>,
  centerSkuKey: string,
  endDate: string,
  days: number,
) {
  let total = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(endDate, -offset);
    total += index.get(`${centerSkuKey}||${date}`) ?? 0;
  }
  return total;
}

function decideAction({
  doh7,
  vel7,
  requiredNet,
  stockIncoming,
  config,
}: {
  doh7: number;
  vel7: number;
  requiredNet: number;
  stockIncoming: number;
  config: AmazonDohConfig;
}) {
  if (vel7 <= 0) {
    return {
      status: "NO_SALES" as const,
      urgencyRank: 6,
      actionLabel: "판매 없음",
      actionReason: "최근 7일 판매가 없어 발송 필요 수량을 계산하지 않습니다.",
    };
  }

  if (requiredNet <= 0 && doh7 < config.targetDays && stockIncoming > 0) {
    return {
      status: "WATCH_INCOMING" as const,
      urgencyRank: 4,
      actionLabel: "입고 진행 중, 모니터링",
      actionReason: "현재 DOH는 목표 미만이지만 입고/처리 중 수량 반영 후 목표 재고가 커버됩니다.",
    };
  }

  if (doh7 < config.dangerDays && requiredNet > 0) {
    return {
      status: "CRITICAL_SEND_NOW" as const,
      urgencyRank: 1,
      actionLabel: "지금 발송 필요",
      actionReason: "7일 판매속도 기준 위험일수 미만이며 입고 반영 후에도 부족합니다.",
    };
  }

  if (doh7 < config.warnDays && requiredNet > 0) {
    return {
      status: "SEND_SOON" as const,
      urgencyRank: 2,
      actionLabel: "이번 주 발송 검토",
      actionReason: "7일 판매속도 기준 경고일수 미만이며 추가 발송 수량이 필요합니다.",
    };
  }

  if (doh7 < config.targetDays && requiredNet > 0) {
    return {
      status: "WATCH" as const,
      urgencyRank: 3,
      actionLabel: "목표일수 미만, 추적",
      actionReason: "목표 DOH 미만입니다. 판매 추세가 유지되면 추가 발송이 필요합니다.",
    };
  }

  return {
    status: "OK" as const,
    urgencyRank: 5,
    actionLabel: "정상",
    actionReason: "현재 판매속도 기준 목표 DOH를 충족합니다.",
  };
}

function calculateDoh(stockSellable: number, velocity: number, maxDays: number) {
  if (velocity <= 0) return maxDays;
  return round(Math.min(stockSellable / velocity, maxDays), 2);
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = cleanString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function nonNegative(value: unknown) {
  const numeric = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
