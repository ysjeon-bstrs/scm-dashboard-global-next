import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/scm-dashboard/supabaseClient";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
