import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchOceanStagingStatus } from "@/lib/scm-dashboard/logisticsSettlement/stagingStatus";

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (auth.error === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.error === "forbidden-domain") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const summary = await fetchOceanStagingStatus();
    return NextResponse.json({
      ok: true,
      mode: "ocean",
      source: "supabase:stg_settlement_ocean_lines",
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
