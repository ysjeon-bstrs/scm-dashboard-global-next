import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/scm-dashboard/supabaseClient";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  // Only allow same-origin relative paths to prevent an open redirect via `next`
  // (e.g. https://evil.com or //evil.com, which `new URL` would resolve off-origin).
  const requestedNext = requestUrl.searchParams.get("next");
  const next =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/global/scm-dashboard";

  if (code) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
