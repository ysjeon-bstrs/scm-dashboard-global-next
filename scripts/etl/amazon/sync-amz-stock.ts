import * as mysql from "mysql2/promise";

import {
  transformAmazonInventoryRows,
  type AmazonInventoryRawRow,
  type AmzStockUpsertRow,
} from "../../../src/lib/scm-dashboard/amazonStockEtl.ts";

type CliOptions = {
  apply: boolean;
  schemaCheck: boolean;
  date: string;
  limit?: number;
};

type CrewEnv = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

const DEFAULT_CREW_DB = "boosters_crew";
const DEFAULT_BATCH_SIZE = 500;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const crewEnv = getCrewEnv();

  if (options.schemaCheck) {
    await runSchemaCheck(crewEnv);
    return;
  }

  const rawRows = await extractAmazonInventoryRows(crewEnv, options.limit);
  const payload = transformAmazonInventoryRows(rawRows, options.date);
  const summary = summarizePayload(payload, rawRows.length, options.date);

  console.log(JSON.stringify({ mode: options.apply ? "apply" : "dry-run", ...summary }, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Re-run with --apply to upsert into Supabase amz_stock.");
    return;
  }

  const written = await upsertAmzStock(payload);
  console.log(JSON.stringify({ status: "SUCCESS", upsertedRows: written }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const options: CliOptions = { apply: false, schemaCheck: false, date: today };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--schema-check") options.schemaCheck = true;
    else if (arg === "--date") options.date = requireArg(args, ++i, "--date");
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, "--limit"));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  }

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  return options;
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function getCrewEnv(): CrewEnv {
  return {
    host: requireEnv("BOOSTERS_CREW_MYSQL_HOST"),
    port: Number(process.env.BOOSTERS_CREW_MYSQL_PORT || 3306),
    database: process.env.BOOSTERS_CREW_MYSQL_DATABASE || DEFAULT_CREW_DB,
    user: requireEnv("BOOSTERS_CREW_MYSQL_USER"),
    password: requireEnv("BOOSTERS_CREW_MYSQL_PASSWORD"),
  };
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function connectCrew(env: CrewEnv) {
  return mysql.createConnection({
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    connectTimeout: 10_000,
    timezone: "+00:00",
  });
}

async function runSchemaCheck(env: CrewEnv) {
  const conn = await connectCrew(env);
  try {
    const requiredColumns = new Map<string, string[]>([
      [
        "amazon_fba_inventorys",
        [
          "marketplaceid",
          "asin",
          "fulfillable_quantity",
          "pending_transshipment_quantity",
          "inbound_shipped_quantity",
          "inbound_receiving_quantity",
          "inbound_working_quantity",
          "pending_customer_order_quantity",
          "fc_processing_quantity",
          "updated_at",
        ],
      ],
      ["boosters_item_groups", ["resource_code", "resource_name", "amazon_seller_asin"]],
    ]);

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name IN ('amazon_fba_inventorys', 'boosters_item_groups')
        ORDER BY table_name, ordinal_position`,
      [env.database],
    );

    const actual = new Map<string, Set<string>>();
    for (const row of rows) {
      const table = String(row.table_name);
      const column = String(row.column_name);
      if (!actual.has(table)) actual.set(table, new Set());
      actual.get(table)?.add(column);
    }

    const report = Array.from(requiredColumns, ([table, columns]) => ({
      table,
      exists: actual.has(table),
      missingColumns: columns.filter((column) => !actual.get(table)?.has(column)),
      observedColumnCount: actual.get(table)?.size ?? 0,
    }));

    console.log(JSON.stringify({ database: env.database, schemaCheck: report }, null, 2));
  } finally {
    await conn.end();
  }
}

async function extractAmazonInventoryRows(env: CrewEnv, limit?: number) {
  const conn = await connectCrew(env);
  try {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
          MAX(p.updated_at) AS latest_updated_at,
          p.marketplaceid,
          CASE p.marketplaceid
            WHEN 'ATVPDKIKX0DER' THEN 'US'
            WHEN 'A1PA6795UKMFR9' THEN 'DE'
            WHEN 'A1F83G8C2ARO7P' THEN 'UK'
            WHEN 'A2VIGQ35RCS4UG' THEN 'AE'
            ELSE 'OTHER'
          END AS country,
          m.resource_code,
          SUM(COALESCE(p.fulfillable_quantity, 0)) AS fulfillable_quantity,
          SUM(COALESCE(p.pending_transshipment_quantity, 0)) AS pending_transshipment_quantity,
          SUM(COALESCE(p.inbound_shipped_quantity, 0)) AS inbound_shipped_quantity,
          SUM(COALESCE(p.inbound_receiving_quantity, 0)) AS inbound_receiving_quantity,
          SUM(COALESCE(p.inbound_working_quantity, 0)) AS inbound_working_quantity,
          SUM(COALESCE(p.pending_customer_order_quantity, 0)) AS pending_customer_order_quantity,
          SUM(COALESCE(p.fc_processing_quantity, 0)) AS fc_processing_quantity,
          GROUP_CONCAT(DISTINCT p.asin ORDER BY p.asin SEPARATOR ',') AS asin_list
         FROM amazon_fba_inventorys p
         JOIN (
           SELECT
             x.marketplaceid,
             x.asin,
             COALESCE(
               MAX(CASE WHEN x.marketplaceid = 'A2VIGQ35RCS4UG' AND x.seller_sku LIKE '%-AE' THEN x.id END),
               MAX(CASE WHEN x.fn_sku = x.asin THEN x.id END),
               MAX(x.id)
             ) AS pick_id
           FROM amazon_fba_inventorys x
           WHERE x.updated_at <= NOW()
             AND x.fn_sku <> 'X004B9WFEL'
             AND x.marketplaceid IN (
               'ATVPDKIKX0DER',
               'A1PA6795UKMFR9',
               'A1F83G8C2ARO7P',
               'A2VIGQ35RCS4UG'
             )
           GROUP BY x.marketplaceid, x.asin
         ) pick
           ON p.id = pick.pick_id
         JOIN (
           SELECT asin, MIN(resource_code) AS resource_code
           FROM (
             SELECT amazon_seller_asin AS asin, resource_code
             FROM boosters_item_groups
             WHERE resource_code LIKE 'BA0%'
           ) mapped
           GROUP BY asin
         ) m
           ON p.asin = m.asin
        WHERE p.marketplaceid IN (
          'ATVPDKIKX0DER',
          'A1PA6795UKMFR9',
          'A1F83G8C2ARO7P',
          'A2VIGQ35RCS4UG'
        )
        GROUP BY p.marketplaceid, country, m.resource_code
        HAVING
          SUM(COALESCE(p.total_quantity, 0)) > 3
          OR SUM(COALESCE(p.inbound_working_quantity, 0)) > 0
          OR SUM(COALESCE(p.inbound_shipped_quantity, 0)) > 0
          OR SUM(COALESCE(p.inbound_receiving_quantity, 0)) > 0
        ORDER BY latest_updated_at DESC, country, SUM(COALESCE(p.total_quantity, 0)) DESC
        ${limitClause}`,
    );

    return rows.map((row) => ({
      marketplaceid: row.marketplaceid,
      country: row.country,
      resource_code: row.resource_code,
      fulfillable_quantity: row.fulfillable_quantity,
      pending_transshipment_quantity: row.pending_transshipment_quantity,
      inbound_shipped_quantity: row.inbound_shipped_quantity,
      inbound_receiving_quantity: row.inbound_receiving_quantity,
      inbound_working_quantity: row.inbound_working_quantity,
      pending_customer_order_quantity: row.pending_customer_order_quantity,
      fc_processing_quantity: row.fc_processing_quantity,
      asin_list: row.asin_list,
      latest_updated_at: row.latest_updated_at,
    })) satisfies AmazonInventoryRawRow[];
  } finally {
    await conn.end();
  }
}

function summarizePayload(payload: AmzStockUpsertRow[], sourceRows: number, date: string) {
  const byCenter = payload.reduce<Record<string, { rows: number; stock_sellable: number }>>(
    (acc, row) => {
      acc[row.center] ??= { rows: 0, stock_sellable: 0 };
      acc[row.center].rows += 1;
      acc[row.center].stock_sellable += row.stock_sellable;
      return acc;
    },
    {},
  );

  return {
    date,
    sourceRows,
    transformedRows: payload.length,
    byCenter,
    sample: payload.slice(0, 3),
  };
}

async function upsertAmzStock(payload: AmzStockUpsertRow[]) {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const apiKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const endpoint = `${url}/rest/v1/amz_stock?on_conflict=raw_key`;

  let written = 0;
  for (let i = 0; i < payload.length; i += DEFAULT_BATCH_SIZE) {
    const chunk = payload.slice(i, i + DEFAULT_BATCH_SIZE);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert failed (${res.status}): ${body}`);
    }

    written += chunk.length;
  }

  return written;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "ERROR", message: error.message }, null, 2));
  process.exit(1);
});
