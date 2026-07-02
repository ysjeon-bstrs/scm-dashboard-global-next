import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/scm-dashboard/supabaseClient";

export async function POST(request: Request) {
  // CSRF guard: browsers always attach Origin to POST; require it to match the
  // request host so cross-site pages cannot force a logout. Fail closed.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const originHost = (() => {
    try {
      return origin ? new URL(origin).host : null;
    } catch {
      return null;
    }
  })();
  if (!originHost || !host || originHost !== host) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
