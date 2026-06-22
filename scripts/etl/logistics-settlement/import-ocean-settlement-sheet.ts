import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import {
  DEFAULT_OCEAN_SHEET_NAME,
  DEFAULT_OCEAN_SPREADSHEET_ID,
  runOceanSheetImport,
} from "../../../src/lib/scm-dashboard/logisticsSettlement/oceanImport.ts";
import { buildLogisticsEtlRunId } from "../../../src/lib/scm-dashboard/logisticsSettlement/jobTypes.ts";

type CliOptions = {
  apply: boolean;
  spreadsheetId: string;
  sheetName: string;
  range?: string;
  limit?: number;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const etlRunId = buildLogisticsEtlRunId("logistics_settlement_ocean_import_sheet");
  const accessToken = await getLocalGoogleAccessToken();
  const summary = await runOceanSheetImport({
    apply: options.apply,
    spreadsheetId: options.spreadsheetId,
    sheetName: options.sheetName,
    range: options.range,
    limit: options.limit,
    etlRunId,
    accessToken,
  });

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    etlRunId,
    ...summary,
  }, null, 2));

  if (!options.apply) {
    console.log("Dry-run only. Re-run with --apply to upsert stg_settlement_ocean_lines.");
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    spreadsheetId: DEFAULT_OCEAN_SPREADSHEET_ID,
    sheetName: DEFAULT_OCEAN_SHEET_NAME,
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

type GoogleToken = {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
};

async function getLocalGoogleAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  if (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return refreshGoogleAccessToken({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      token_uri: process.env.GOOGLE_TOKEN_URI ?? "https://oauth2.googleapis.com/token",
    });
  }

  const tokenPath = process.env.HERMES_GOOGLE_TOKEN_PATH ?? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "hermes", "google_token.json");
  const token = JSON.parse(await readFile(tokenPath, "utf8")) as GoogleToken;
  if (token.token && token.expiry && new Date(token.expiry).getTime() - Date.now() > 60_000) return token.token;
  return refreshGoogleAccessToken(token);
}

async function refreshGoogleAccessToken(token: GoogleToken) {
  if (!token.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error("Google refresh token/client credentials are missing.");
  }
  const response = await fetch(token.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: token.client_id,
      client_secret: token.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth refresh failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth refresh did not return access_token");
  return payload.access_token;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
