import { readFile } from "node:fs/promises";

import { getSupabaseRestEnv, supabaseGetAll } from "../../../src/lib/scm-dashboard/logisticsSettlement/supabaseRest.ts";

type CliOptions = {
  month?: string;
  fixture?: string;
};

type MartRow = {
  settlement_month: string;
  bl_no: string;
  invoice_no: string;
  resource_code: string;
  qty_ea: number | string | null;
  sku_logistics_alloc_krw: number | string | null;
  sku_freight_unit_krw: number | string | null;
  sku_duty_unit_krw: number | string | null;
  sku_other_unit_krw: number | string | null;
};

type LegacyFixture = {
  rows?: Array<{
    month?: string;
    bl_no: string;
    invoice_no?: string;
    resource_code: string;
    qty_ea?: number;
    sku_logistics_alloc_krw?: number;
    sku_freight_unit_krw?: number;
    sku_duty_unit_krw?: number;
    sku_other_unit_krw?: number;
  }>;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = getSupabaseRestEnv();
  const params = new URLSearchParams({
    select: "settlement_month,bl_no,invoice_no,resource_code,qty_ea,sku_logistics_alloc_krw,sku_freight_unit_krw,sku_duty_unit_krw,sku_other_unit_krw",
    carrier_mode: "eq.해상",
    order: "settlement_month.asc,bl_no.asc,resource_code.asc",
  });
  if (options.month) params.set("settlement_month", `eq.${options.month}`);

  const martRows = await supabaseGetAll<MartRow>(env, "mart_logistics_doc_analysis", params);
  const martSummary = summarize(martRows.map((row) => ({
    key: rowKey(row.bl_no, row.resource_code),
    month: row.settlement_month,
    bl_no: row.bl_no,
    invoice_no: row.invoice_no,
    resource_code: row.resource_code,
    qty_ea: numberValue(row.qty_ea),
    sku_logistics_alloc_krw: numberValue(row.sku_logistics_alloc_krw),
    sku_freight_unit_krw: numberValue(row.sku_freight_unit_krw),
    sku_duty_unit_krw: numberValue(row.sku_duty_unit_krw),
    sku_other_unit_krw: numberValue(row.sku_other_unit_krw),
  })));

  let fixtureReport: unknown = null;
  if (options.fixture) {
    const fixture = JSON.parse(await readFile(options.fixture, "utf8")) as LegacyFixture;
    const legacyRows = (fixture.rows ?? []).map((row) => ({
      key: rowKey(row.bl_no, row.resource_code),
      month: row.month ?? "",
      bl_no: row.bl_no,
      invoice_no: row.invoice_no ?? "",
      resource_code: row.resource_code,
      qty_ea: row.qty_ea ?? 0,
      sku_logistics_alloc_krw: row.sku_logistics_alloc_krw ?? 0,
      sku_freight_unit_krw: row.sku_freight_unit_krw ?? 0,
      sku_duty_unit_krw: row.sku_duty_unit_krw ?? 0,
      sku_other_unit_krw: row.sku_other_unit_krw ?? 0,
    }));
    fixtureReport = compareRows(martSummary.rowsByKey, summarize(legacyRows).rowsByKey);
  }

  console.log(JSON.stringify({
    ok: !fixtureReport || (fixtureReport as { diffCount: number }).diffCount === 0,
    month: options.month ?? null,
    mart: {
      rows: martRows.length,
      bl_count: martSummary.blCount,
      invoice_count: martSummary.invoiceCount,
      qty_ea: martSummary.qtyEa,
      sku_logistics_alloc_krw: martSummary.skuLogisticsAllocKrw,
    },
    fixture: fixtureReport,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--month") options.month = requireArg(args, ++i, "--month");
    else if (arg === "--fixture") options.fixture = requireArg(args, ++i, "--fixture");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function rowKey(blNo: string, resourceCode: string) {
  return `${blNo}::${resourceCode}`;
}

function summarize(rows: Array<{
  key: string;
  bl_no: string;
  invoice_no: string;
  qty_ea: number;
  sku_logistics_alloc_krw: number;
}>) {
  const rowsByKey = new Map<string, typeof rows[number]>();
  let qtyEa = 0;
  let skuLogisticsAllocKrw = 0;
  const bls = new Set<string>();
  const invoices = new Set<string>();
  for (const row of rows) {
    rowsByKey.set(row.key, row);
    qtyEa += row.qty_ea;
    skuLogisticsAllocKrw += row.sku_logistics_alloc_krw;
    if (row.bl_no) bls.add(row.bl_no);
    if (row.invoice_no) invoices.add(row.invoice_no);
  }
  return { rowsByKey, qtyEa, skuLogisticsAllocKrw, blCount: bls.size, invoiceCount: invoices.size };
}

function compareRows(newRows: Map<string, { qty_ea: number; sku_logistics_alloc_krw: number }>, legacyRows: Map<string, { qty_ea: number; sku_logistics_alloc_krw: number }>) {
  const diffs: Array<{ key: string; field: string; mart: number | null; legacy: number | null }> = [];
  const keys = new Set([...Array.from(newRows.keys()), ...Array.from(legacyRows.keys())]);
  for (const key of Array.from(keys)) {
    const mart = newRows.get(key);
    const legacy = legacyRows.get(key);
    if (!mart || !legacy) {
      diffs.push({ key, field: "row_presence", mart: mart ? 1 : null, legacy: legacy ? 1 : null });
      continue;
    }
    if (Math.round(mart.qty_ea) !== Math.round(legacy.qty_ea)) {
      diffs.push({ key, field: "qty_ea", mart: mart.qty_ea, legacy: legacy.qty_ea });
    }
    if (Math.abs(mart.sku_logistics_alloc_krw - legacy.sku_logistics_alloc_krw) > 1) {
      diffs.push({ key, field: "sku_logistics_alloc_krw", mart: mart.sku_logistics_alloc_krw, legacy: legacy.sku_logistics_alloc_krw });
    }
  }
  return { diffCount: diffs.length, diffs: diffs.slice(0, 50) };
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
