import mysql, { type Pool } from "mysql2/promise";

let sourceDbPool: Pool | null = null;
let crewDbPool: Pool | null = null;

type QueryValue = string | number | boolean | Date | null;
type QueryParams = QueryValue[] | Record<string, QueryValue>;

function normalizeEnvValue(value: string | undefined, names: string[]) {
  if (!value) return undefined;
  let normalized = value.trim();

  for (const name of names) {
    const prefix = `${name}=`;
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim();
      break;
    }
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  return normalized;
}

function getEnv(name: string, legacyName?: string) {
  const names = [name, legacyName].filter((value): value is string => Boolean(value));
  return normalizeEnvValue(process.env[name], names) ||
    (legacyName ? normalizeEnvValue(process.env[legacyName], names) : undefined);
}

function requireSourceEnv(name: string, legacyName?: string) {
  const value = getEnv(name, legacyName);

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function assertReadOnlySql(sql: string) {
  const normalized = sql.trim().replace(/;+\s*$/, "").toLowerCase();
  const isReadOnly =
    /^select\b/.test(normalized) ||
    /^show\b/.test(normalized) ||
    /^describe\b/.test(normalized) ||
    /^desc\b/.test(normalized);

  if (!isReadOnly) {
    throw new Error("Only read-only MySQL queries are allowed in this prototype.");
  }
}

function getSourceDbPool() {
  if (!sourceDbPool) {
    sourceDbPool = mysql.createPool({
      host: requireSourceEnv("SCM_SOURCE_DB_HOST", "BOOSTERS_SCM_MYSQL_HOST"),
      port: Number(
        getEnv("SCM_SOURCE_DB_PORT", "BOOSTERS_SCM_MYSQL_PORT") ?? 3306,
      ),
      database: requireSourceEnv(
        "SCM_SOURCE_DB_DATABASE",
        "BOOSTERS_SCM_MYSQL_DATABASE",
      ),
      user: requireSourceEnv("SCM_SOURCE_DB_USER", "BOOSTERS_SCM_MYSQL_USER"),
      password: requireSourceEnv(
        "SCM_SOURCE_DB_PASSWORD",
        "BOOSTERS_SCM_MYSQL_PASSWORD",
      ),
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      namedPlaceholders: true,
      timezone: "+00:00",
    });
  }

  return sourceDbPool;
}

function getCrewDbPool() {
  if (!crewDbPool) {
    crewDbPool = mysql.createPool({
      host: requireSourceEnv("BOOSTERS_CREW_MYSQL_HOST"),
      port: Number(getEnv("BOOSTERS_CREW_MYSQL_PORT") ?? 3306),
      database: getEnv("BOOSTERS_CREW_MYSQL_DATABASE") ?? "boosters",
      user: requireSourceEnv("BOOSTERS_CREW_MYSQL_USER"),
      password: requireSourceEnv("BOOSTERS_CREW_MYSQL_PASSWORD"),
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      namedPlaceholders: true,
      timezone: "+00:00",
    });
  }

  return crewDbPool;
}

export async function querySourceDbReadOnly<T>(
  sql: string,
  params?: QueryParams,
) {
  assertReadOnlySql(sql);
  const pool = getSourceDbPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryCrewDbReadOnly<T>(
  sql: string,
  params?: QueryParams,
) {
  assertReadOnlySql(sql);
  const pool = getCrewDbPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function testSourceDbConnection() {
  return querySourceDbReadOnly<{ ok: number }>("SELECT 1 AS ok");
}

export async function testCrewDbConnection() {
  return queryCrewDbReadOnly<{ ok: number }>("SELECT 1 AS ok");
}

export const queryBoostersScmReadOnly = querySourceDbReadOnly;
export const testBoostersScmConnection = testSourceDbConnection;
