import mysql, { type Pool } from "mysql2/promise";

let sourceDbPool: Pool | null = null;

type QueryValue = string | number | boolean | Date | null;
type QueryParams = QueryValue[] | Record<string, QueryValue>;

function getEnv(name: string, legacyName?: string) {
  return process.env[name] || (legacyName ? process.env[legacyName] : undefined);
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

export async function querySourceDbReadOnly<T>(
  sql: string,
  params?: QueryParams,
) {
  assertReadOnlySql(sql);
  const pool = getSourceDbPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function testSourceDbConnection() {
  return querySourceDbReadOnly<{ ok: number }>("SELECT 1 AS ok");
}

export const queryBoostersScmReadOnly = querySourceDbReadOnly;
export const testBoostersScmConnection = testSourceDbConnection;
