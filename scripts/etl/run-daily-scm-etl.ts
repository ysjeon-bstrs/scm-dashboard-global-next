import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

type CliOptions = {
  apply: boolean;
  date: string;
  salesOverlapDays: number;
  salesBootstrapDays: number;
  skipDomestic: boolean;
  skipAmazonInventory: boolean;
  skipAmazonSales: boolean;
  skipAmazonDoh: boolean;
};

type SupabaseEnv = {
  url: string;
  apiKey: string;
};

const DEFAULT_SALES_OVERLAP_DAYS = 5;
const DEFAULT_SALES_BOOTSTRAP_DAYS = 100;

async function main() {
  loadDotEnvLocal();
  const options = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseEnv();
  const salesWindowEnd = addDays(options.date, -1);
  const salesWindowStart = addDays(salesWindowEnd, -(options.salesBootstrapDays - 1));
  const latestSalesDate = await fetchLatestDate(supabase, "mart_amazon_sales_daily", "order_date_pt");
  const salesStartDate = resolveSalesStartDate({
    latestSalesDate,
    salesWindowStart,
    salesWindowEnd,
    overlapDays: options.salesOverlapDays,
  });

  const plan = {
    mode: options.apply ? "apply" : "dry-run",
    snapshot_date: options.date,
    amazon_sales_window_end: salesWindowEnd,
    amazon_sales_window_start_floor: salesWindowStart,
    latest_amazon_sales_date: latestSalesDate,
    amazon_sales_start_date: salesStartDate,
    sales_overlap_days: options.salesOverlapDays,
    sales_bootstrap_days: options.salesBootstrapDays,
    skipped: {
      domestic: options.skipDomestic,
      amazon_inventory: options.skipAmazonInventory,
      amazon_sales: options.skipAmazonSales,
      amazon_doh: options.skipAmazonDoh,
    },
  };

  console.log(JSON.stringify({ daily_scm_etl_plan: plan }, null, 2));

  const failures: Array<{ step: string; status: number | null }> = [];

  if (!options.skipDomestic) {
    runStep("designkr-domestic-stock", ["scripts/etl/domestic/sync-designkr-stock.ts", ...(options.apply ? ["--apply"] : [])], failures);
  }

  if (!options.skipAmazonInventory) {
    runStep(
      "amazon-inventory",
      [
        "scripts/etl/amazon/sync-amazon-inventory.ts",
        "--date",
        options.date,
        "--skip-parity",
        ...(options.apply ? ["--apply"] : []),
      ],
      failures,
    );
  }

  if (!options.skipAmazonSales) {
    if (salesStartDate > salesWindowEnd) {
      console.log(JSON.stringify({ step: "amazon-sales", status: "SKIPPED", reason: "sales_start_date_after_window_end", salesStartDate, salesWindowEnd }, null, 2));
    } else {
      runStep(
        "amazon-sales",
        [
          "scripts/etl/amazon/sync-amazon-sales.ts",
          "--start-date",
          salesStartDate,
          "--end-date",
          salesWindowEnd,
          ...(options.apply ? ["--apply"] : []),
        ],
        failures,
      );
    }
  }

  if (!options.skipAmazonDoh) {
    runStep(
      "amazon-doh",
      ["scripts/etl/amazon/sync-amazon-doh.ts", "--date", options.date, ...(options.apply ? ["--apply"] : [])],
      failures,
    );
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ status: "FAILED", failures }, null, 2));
    process.exit(1);
  }

  const freshness = await fetchFreshnessSummary(supabase);
  console.log(JSON.stringify({ status: "SUCCESS", freshness }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    date: todayInTimeZone("Asia/Seoul"),
    salesOverlapDays: DEFAULT_SALES_OVERLAP_DAYS,
    salesBootstrapDays: DEFAULT_SALES_BOOTSTRAP_DAYS,
    skipDomestic: false,
    skipAmazonInventory: false,
    skipAmazonSales: false,
    skipAmazonDoh: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--date") options.date = requireArg(args, ++i, "--date");
    else if (arg === "--sales-overlap-days") options.salesOverlapDays = Number(requireArg(args, ++i, "--sales-overlap-days"));
    else if (arg === "--sales-bootstrap-days") options.salesBootstrapDays = Number(requireArg(args, ++i, "--sales-bootstrap-days"));
    else if (arg === "--skip-domestic") options.skipDomestic = true;
    else if (arg === "--skip-amazon-inventory") options.skipAmazonInventory = true;
    else if (arg === "--skip-amazon-sales") options.skipAmazonSales = true;
    else if (arg === "--skip-amazon-doh") options.skipAmazonDoh = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  if (!Number.isInteger(options.salesOverlapDays) || options.salesOverlapDays < 0) throw new Error("--sales-overlap-days must be a non-negative integer");
  if (!Number.isInteger(options.salesBootstrapDays) || options.salesBootstrapDays < 1) throw new Error("--sales-bootstrap-days must be a positive integer");
  return options;
}

function printHelp() {
  console.log(`Daily SCM ETL orchestrator\n\nDefault mode is dry-run. Add --apply to write Supabase marts.\n\nUsage:\n  npx tsx scripts/etl/run-daily-scm-etl.ts [--apply] [--date YYYY-MM-DD]\n\nOptions:\n  --date YYYY-MM-DD              Snapshot date for Amazon inventory/DOH. Default: KST today.\n  --sales-overlap-days N         Re-upsert recent N days before latest loaded sales date. Default: ${DEFAULT_SALES_OVERLAP_DAYS}.\n  --sales-bootstrap-days N       If sales mart is empty/old, load at most N-day DOH window. Default: ${DEFAULT_SALES_BOOTSTRAP_DAYS}.\n  --skip-domestic                Skip 디자인KR ETL.\n  --skip-amazon-inventory        Skip Amazon inventory ETL.\n  --skip-amazon-sales            Skip Amazon sales ETL.\n  --skip-amazon-doh              Skip Amazon DOH ETL.\n`);
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function loadDotEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getSupabaseEnv(): SupabaseEnv {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, apiKey };
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function runStep(step: string, scriptArgs: string[], failures: Array<{ step: string; status: number | null }>) {
  console.log(JSON.stringify({ step, status: "START", command: ["npx", "tsx", ...scriptArgs].join(" ") }, null, 2));
  const result = spawnSync("npx", ["tsx", ...scriptArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(JSON.stringify({ step, status: "ERROR", message: result.error.message }, null, 2));
    failures.push({ step, status: result.status });
    return;
  }

  if (result.status !== 0) {
    failures.push({ step, status: result.status });
    console.error(JSON.stringify({ step, status: "FAILED", exitCode: result.status }, null, 2));
  } else {
    console.log(JSON.stringify({ step, status: "OK" }, null, 2));
  }
}

async function fetchLatestDate(env: SupabaseEnv, table: string, column: string) {
  const rows = await supabaseGet<Array<Record<string, string | null>>>(env, table, new URLSearchParams({
    select: column,
    order: `${column}.desc`,
    limit: "1",
  }));
  return rows[0]?.[column] ?? null;
}

async function fetchFreshnessSummary(env: SupabaseEnv) {
  return {
    domestic_stock_snapshot: await fetchLatestDate(env, "mart_domestic_stock_sku_snapshot", "snapshot_date"),
    amazon_inventory_snapshot: await fetchLatestDate(env, "mart_amazon_inventory_snapshot", "snapshot_date"),
    amazon_sales_daily: await fetchLatestDate(env, "mart_amazon_sales_daily", "order_date_pt"),
    amazon_doh_snapshot: await fetchLatestDate(env, "mart_amazon_doh_snapshot", "snapshot_date"),
  };
}

async function supabaseGet<T>(env: SupabaseEnv, table: string, params: URLSearchParams): Promise<T> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${params.toString()}`, {
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

function resolveSalesStartDate({
  latestSalesDate,
  salesWindowStart,
  salesWindowEnd,
  overlapDays,
}: {
  latestSalesDate: string | null;
  salesWindowStart: string;
  salesWindowEnd: string;
  overlapDays: number;
}) {
  if (!latestSalesDate) return salesWindowStart;
  const overlapped = addDays(latestSalesDate, -overlapDays);
  const start = maxDate(overlapped, salesWindowStart);
  if (start > salesWindowEnd) return salesWindowEnd;
  return start;
}

function todayInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "ERROR", message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
