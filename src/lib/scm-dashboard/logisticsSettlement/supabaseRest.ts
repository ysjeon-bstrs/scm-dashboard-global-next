type SupabaseEnv = {
  url: string;
  apiKey: string;
};

type SupabaseRecord = Record<string, unknown>;

export function getSupabaseRestEnv(options: { requireServiceRole?: boolean } = {}): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (options.requireServiceRole && !serviceRole) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for ETL apply mode");
  }

  const apiKey = serviceRole || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey) throw new Error("Missing Supabase API key");

  return { url, apiKey };
}

/**
 * Build an error for a failed Supabase REST call. The full response body (which can
 * leak PostgREST internals: column names, constraints, hints) is logged server-side
 * only; the thrown message is bounded to the action/table/status.
 */
async function supabaseError(action: string, table: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  console.error(`[supabase] ${action} ${table} failed: ${response.status} ${body}`);
  return new Error(`Supabase ${action} failed for ${table} (${response.status})`);
}

export async function supabaseUpsertRows<T extends SupabaseRecord>(
  env: SupabaseEnv,
  table: string,
  conflictKey: string,
  rows: T[],
) {
  if (!rows.length) return { written: 0 };

  const response = await fetch(`${env.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictKey)}`, {
    method: "POST",
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw await supabaseError("upsert", table, response);
  }

  return { written: rows.length };
}

export async function supabaseGetAll<T>(env: SupabaseEnv, table: string, query: URLSearchParams) {
  const rows: T[] = [];
  const pageSize = 1000;

  // Honor a caller-supplied `limit` as an overall row cap; absent/invalid means exhaustive.
  const requestedLimit = Number(query.get("limit"));
  const maxRows = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : Infinity;

  for (let offset = 0; rows.length < maxRows; offset += pageSize) {
    const pageLimit = Math.min(pageSize, maxRows - rows.length);
    const params = new URLSearchParams(query);
    params.set("limit", String(pageLimit));
    params.set("offset", String(offset));

    const response = await fetch(`${env.url}/rest/v1/${table}?${params.toString()}`, {
      headers: {
        apikey: env.apiKey,
        authorization: `Bearer ${env.apiKey}`,
      },
    });

    if (!response.ok) {
      throw await supabaseError("read", table, response);
    }

    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < pageLimit) break;
  }

  return rows;
}

function totalFromContentRange(header: string | null): number {
  // PostgREST count header looks like "0-24/3573" or "*/3573"; the count is after the slash.
  const total = header ? Number(header.split("/").pop()) : NaN;
  return Number.isFinite(total) ? total : 0;
}

export async function supabaseCount(env: SupabaseEnv, table: string, filters: URLSearchParams): Promise<number> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${filters.toString()}`, {
    method: "HEAD",
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
      prefer: "count=exact",
    },
  });

  if (!response.ok) {
    throw await supabaseError("count", table, response);
  }

  return totalFromContentRange(response.headers.get("content-range"));
}

export async function supabaseDelete(env: SupabaseEnv, table: string, filters: URLSearchParams): Promise<{ deleted: number }> {
  // Safety: never issue an unfiltered DELETE (which would wipe the whole table).
  if (Array.from(filters.keys()).length === 0) {
    throw new Error(`supabaseDelete refused: no filters for ${table}`);
  }

  const response = await fetch(`${env.url}/rest/v1/${table}?${filters.toString()}`, {
    method: "DELETE",
    headers: {
      apikey: env.apiKey,
      authorization: `Bearer ${env.apiKey}`,
      prefer: "count=exact,return=minimal",
    },
  });

  if (!response.ok) {
    throw await supabaseError("delete", table, response);
  }

  return { deleted: totalFromContentRange(response.headers.get("content-range")) };
}
