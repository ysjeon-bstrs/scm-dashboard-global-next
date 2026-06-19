import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchDomesticStockSummary } from "@/lib/scm-dashboard/domesticStockQueries";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await fetchDomesticStockSummary({
      warehouseCode: request.nextUrl.searchParams.get("warehouse_code") ?? undefined,
      snapshotDate: request.nextUrl.searchParams.get("snapshot_date"),
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
