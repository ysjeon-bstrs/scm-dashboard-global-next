import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import {
  getSupabaseRestEnv,
  supabaseUpsertRows,
} from "../../../src/lib/scm-dashboard/logisticsSettlement/supabaseRest.ts";

type CliOptions = {
  apply: boolean;
  spreadsheetId: string;
  sheetName: string;
  range: string;
  limit?: number;
};

type GoogleToken = {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
};

type StagingRow = Record<string, string | number | null>;

const DEFAULT_SPREADSHEET_ID = "1lMcYrjTOePfXTQIb6fMqluLAXyXuhTY3zAbzdeEehvs";
const DEFAULT_SHEET_NAME = "해상_정산";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = await getAccessToken();
  const values = await fetchSheetValues(token, options);
  const rows = transformSheetValues(values, options);

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    spreadsheetId: options.spreadsheetId,
    sheetName: options.sheetName,
    sourceRows: Math.max(values.length - 1, 0),
    transformedRows: rows.length,
    samples: rows.slice(0, 5),
  };
  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Re-run with --apply to upsert stg_settlement_ocean_lines.");
    return;
  }

  const supabase = getSupabaseRestEnv({ requireServiceRole: true });
  const result = await supabaseUpsertRows(supabase, "stg_settlement_ocean_lines", "raw_key", rows);
  console.log(JSON.stringify({ status: "SUCCESS", ...result }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    sheetName: DEFAULT_SHEET_NAME,
    range: `${DEFAULT_SHEET_NAME}!A:R`,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--spreadsheet-id") options.spreadsheetId = requireArg(args, ++i, arg);
    else if (arg === "--sheet") options.sheetName = requireArg(args, ++i, arg);
    else if (arg === "--range") options.range = requireArg(args, ++i, arg);
    else if (arg === "--limit") options.limit = Number(requireArg(args, ++i, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.range === `${DEFAULT_SHEET_NAME}!A:R` && options.sheetName !== DEFAULT_SHEET_NAME) {
    options.range = `${options.sheetName}!A:R`;
  }
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number");
  }

  return options;
}

function requireArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function getAccessToken() {
  const tokenPath = process.env.HERMES_GOOGLE_TOKEN_PATH ?? path.join(localAppData(), "hermes", "google_token.json");
  const token = JSON.parse(await readFile(tokenPath, "utf8")) as GoogleToken;
  if (!token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error(`Google token at ${tokenPath} is missing refresh_token/client_id/client_secret`);
  }

  if (token.token && token.expiry && new Date(token.expiry).getTime() - Date.now() > 60_000) {
    return token.token;
  }

  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetch(token.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google OAuth refresh failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth refresh did not return access_token");
  return payload.access_token;
}

async function fetchSheetValues(accessToken: string, options: CliOptions): Promise<string[][]> {
  const endpoint = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${options.spreadsheetId}/values/${encodeURIComponent(options.range)}`);
  endpoint.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets read failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { values?: string[][] };
  return payload.values ?? [];
}

function transformSheetValues(values: string[][], options: CliOptions): StagingRow[] {
  const [headersRaw, ...dataRows] = values;
  if (!headersRaw?.length) return [];
  const headers = headersRaw.map((header) => normalizeHeader(header));
  const limit = options.limit ?? dataRows.length;
  const rows: StagingRow[] = [];

  for (let index = 0; index < Math.min(dataRows.length, limit); index += 1) {
    const row = dataRows[index];
    const record = Object.fromEntries(headers.map((header, colIndex) => [header, row[colIndex] ?? ""]));
    const blNo = stringValue(record.bl_no);
    if (!blNo) continue;
    const sheetRow = index + 2;
    rows.push({
      raw_key: `sheet:${options.spreadsheetId}:${options.sheetName}:${sheetRow}`,
      invoice_date: parseSheetDate(stringValue(record.invoice_date)),
      bl_no: blNo,
      country: stringValue(record.country),
      charge_type: stringValue(record.charge_type),
      currency: stringValue(record.currency),
      amount_orig: numberValue(record.amount_orig),
      exrate: numberValue(record.exrate),
      amount_krw: numberValue(record.amount_krw),
      tax_krw: numberValue(record.tax),
      pol: stringValue(record.pol),
      pod: stringValue(record.pod),
      vessel: stringValue(record.vessel),
      weight_kg: numberValue(record.weight_kg),
      cbm: numberValue(record.cbm),
      container_type: stringValue(record.container_type),
      packages: numberValue(record.packages),
      file_name: stringValue(record.file_name),
      file_id: stringValue(record.file_id),
      source_updated_at: null,
      etl_run_id: "sheet_import_ocean_settlement",
    });
  }

  return rows;
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^BL_no$/i, "bl_no")
    .replace(/^POL$/i, "pol")
    .replace(/^POD$/i, "pod")
    .toLowerCase();
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const cleaned = stringValue(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSheetDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dotMatch = trimmed.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (dotMatch) {
    const [, year, month, day] = dotMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const slashMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

function localAppData() {
  return process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
