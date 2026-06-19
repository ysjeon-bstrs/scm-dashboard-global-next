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
    throw new Error(`Supabase upsert failed for ${table}: ${response.status} ${await response.text()}`);
  }

  return { written: rows.length };
}

export async function supabaseGetAll<T>(env: SupabaseEnv, table: string, query: URLSearchParams) {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams(query);
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));

    const response = await fetch(`${env.url}/rest/v1/${table}?${params.toString()}`, {
      headers: {
        apikey: env.apiKey,
        authorization: `Bearer ${env.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase read failed for ${table}: ${response.status} ${await response.text()}`);
    }

    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}
