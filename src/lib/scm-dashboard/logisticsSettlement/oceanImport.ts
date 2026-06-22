import { getSupabaseRestEnv, supabaseUpsertRows } from "./supabaseRest";

export const DEFAULT_OCEAN_SPREADSHEET_ID = "1lMcYrjTOePfXTQIb6fMqluLAXyXuhTY3zAbzdeEehvs";
export const DEFAULT_OCEAN_SHEET_NAME = "해상_정산";

export type OceanImportOptions = {
  apply?: boolean;
  spreadsheetId?: string;
  sheetName?: string;
  range?: string;
  limit?: number;
  etlRunId: string;
  accessToken?: string;
};

export type OceanStagingRow = {
  raw_key: string;
  invoice_date: string | null;
  bl_no: string;
  country: string;
  charge_type: string;
  currency: string;
  amount_orig: number;
  exrate: number;
  amount_krw: number;
  tax_krw: number;
  pol: string;
  pod: string;
  vessel: string;
  weight_kg: number;
  cbm: number;
  container_type: string;
  packages: number;
  file_name: string;
  file_id: string;
  source_updated_at: null;
  etl_run_id: string;
};

export type OceanImportSummary = {
  spreadsheetId: string;
  sheetName: string;
  sourceRows: number;
  parsedRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  duplicateRawKeyCount: number;
  affectedBlCount: number;
  amountTotals: {
    amountKrw: number;
    taxKrw: number;
    byChargeType: Record<string, number>;
  };
  sampleRows: OceanStagingRow[];
  insertedOrUpdatedRowCount?: number;
  targetTable?: "stg_settlement_ocean_lines";
};

type GoogleToken = {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
};

export async function runOceanSheetImport(options: OceanImportOptions): Promise<OceanImportSummary> {
  const resolved = resolveOceanImportOptions(options);
  const token = resolved.accessToken ?? await getGoogleAccessToken();
  const values = await fetchOceanSheetValues(token, resolved);
  const rows = transformOceanSheetValues(values, resolved);
  const summary = summarizeOceanImportRows(rows, {
    sourceRows: Math.max(values.length - 1, 0),
    spreadsheetId: resolved.spreadsheetId,
    sheetName: resolved.sheetName,
  });

  if (!resolved.apply) return summary;

  const supabase = getSupabaseRestEnv({ requireServiceRole: true });
  const result = await supabaseUpsertRows(supabase, "stg_settlement_ocean_lines", "raw_key", rows);
  return {
    ...summary,
    insertedOrUpdatedRowCount: result.written,
    targetTable: "stg_settlement_ocean_lines",
  };
}

export function transformOceanSheetValues(
  values: string[][],
  options: Pick<Required<OceanImportOptions>, "spreadsheetId" | "sheetName" | "etlRunId"> & Pick<OceanImportOptions, "limit">,
): OceanStagingRow[] {
  const [headersRaw, ...dataRows] = values;
  if (!headersRaw?.length) return [];
  const headers = headersRaw.map((header) => normalizeHeader(header));
  const limit = options.limit ?? dataRows.length;
  const rows: OceanStagingRow[] = [];

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
      etl_run_id: options.etlRunId,
    });
  }

  return rows;
}

export function summarizeOceanImportRows(
  rows: OceanStagingRow[],
  context: { sourceRows: number; spreadsheetId: string; sheetName: string },
): OceanImportSummary {
  const rawKeys = new Set<string>();
  let duplicateRawKeyCount = 0;
  const bls = new Set<string>();
  const byChargeType: Record<string, number> = {};
  let amountKrw = 0;
  let taxKrw = 0;

  for (const row of rows) {
    if (rawKeys.has(row.raw_key)) duplicateRawKeyCount += 1;
    rawKeys.add(row.raw_key);
    if (row.bl_no) bls.add(row.bl_no);
    amountKrw += row.amount_krw;
    taxKrw += row.tax_krw;
    const chargeType = row.charge_type || "UNKNOWN";
    byChargeType[chargeType] = (byChargeType[chargeType] ?? 0) + row.amount_krw;
  }

  return {
    spreadsheetId: context.spreadsheetId,
    sheetName: context.sheetName,
    sourceRows: context.sourceRows,
    parsedRowCount: rows.length,
    validRowCount: rows.length,
    invalidRowCount: 0,
    duplicateRawKeyCount,
    affectedBlCount: bls.size,
    amountTotals: { amountKrw, taxKrw, byChargeType },
    sampleRows: rows.slice(0, 5),
  };
}

type ResolvedOceanImportOptions = Omit<Required<OceanImportOptions>, "limit" | "accessToken"> & { limit?: number; accessToken?: string };

function resolveOceanImportOptions(options: OceanImportOptions): ResolvedOceanImportOptions {
  const sheetName = options.sheetName ?? DEFAULT_OCEAN_SHEET_NAME;
  return {
    apply: options.apply ?? false,
    spreadsheetId: options.spreadsheetId ?? process.env.GOOGLE_LOGISTICS_SETTLEMENT_SHEET_ID ?? DEFAULT_OCEAN_SPREADSHEET_ID,
    sheetName,
    range: options.range ?? `${sheetName}!A:R`,
    limit: options.limit,
    etlRunId: options.etlRunId,
    accessToken: options.accessToken,
  };
}

async function getGoogleAccessToken() {
  const envAccessToken = process.env.GOOGLE_ACCESS_TOKEN;
  if (envAccessToken) return envAccessToken;

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenUri = process.env.GOOGLE_TOKEN_URI ?? "https://oauth2.googleapis.com/token";

  if (refreshToken && clientId && clientSecret) {
    return refreshGoogleAccessToken({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      token_uri: tokenUri,
    });
  }

  throw new Error("Missing Google credentials. Set GOOGLE_ACCESS_TOKEN or GOOGLE_REFRESH_TOKEN/GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET for server-side import.");
}

async function refreshGoogleAccessToken(token: GoogleToken) {
  if (!token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error("Google refresh token/client credentials are missing.");
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

async function fetchOceanSheetValues(accessToken: string, options: ResolvedOceanImportOptions): Promise<string[][]> {
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
