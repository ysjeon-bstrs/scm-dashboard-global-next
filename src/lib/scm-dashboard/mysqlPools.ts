import mysql, { type Pool } from "mysql2/promise";

let boostersScmPool: Pool | null = null;

type QueryValue = string | number | boolean | Date | null;
type QueryParams = QueryValue[] | Record<string, QueryValue>;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function assertReadOnlySql(sql: string) {
  const normalized = sql.trim().replace(/;+\s*$/, "").toLowerCase();
  const isReadOnly =
    normalized.startsWith("select ") ||
    normalized.startsWith("show ") ||
    normalized.startsWith("describe ") ||
    normalized.startsWith("desc ");

  if (!isReadOnly) {
    throw new Error("Only read-only MySQL queries are allowed in this prototype.");
  }
}

function getBoostersScmPool() {
  if (!boostersScmPool) {
    boostersScmPool = mysql.createPool({
      host: requireEnv("BOOSTERS_SCM_MYSQL_HOST"),
      port: Number(process.env.BOOSTERS_SCM_MYSQL_PORT ?? 3306),
      database: requireEnv("BOOSTERS_SCM_MYSQL_DATABASE"),
      user: requireEnv("BOOSTERS_SCM_MYSQL_USER"),
      password: requireEnv("BOOSTERS_SCM_MYSQL_PASSWORD"),
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      namedPlaceholders: true,
      timezone: "+00:00",
    });
  }

  return boostersScmPool;
}

export async function queryBoostersScmReadOnly<T>(
  sql: string,
  params?: QueryParams,
) {
  assertReadOnlySql(sql);
  const pool = getBoostersScmPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function testBoostersScmConnection() {
  return queryBoostersScmReadOnly<{ ok: number }>("SELECT 1 AS ok");
}
