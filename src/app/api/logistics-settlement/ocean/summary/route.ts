import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchOceanSettlementSummary } from "@/lib/scm-dashboard/logisticsSettlement/queries";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await fetchOceanSettlementSummary({
      month: request.nextUrl.searchParams.get("month"),
      limit: Number(request.nextUrl.searchParams.get("limit") ?? NaN),
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
