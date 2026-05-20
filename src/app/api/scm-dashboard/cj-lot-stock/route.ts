import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchCjLotStocks } from "@/lib/scm-dashboard/cjQueries";
import { clampLimit } from "@/lib/scm-dashboard/sql";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = clampLimit(request.nextUrl.searchParams.get("limit"), 20, 500);
  const sku = request.nextUrl.searchParams.get("sku");
  const depot = request.nextUrl.searchParams.get("depot");
  const latestOnly = request.nextUrl.searchParams.get("latestOnly") !== "false";

  try {
    const { tableName, rows } = await fetchCjLotStocks({
      limit,
      sku,
      depot,
      latestOnly,
    });

    return NextResponse.json({
      rows,
      meta: {
        table: tableName,
        limit,
        latestOnly,
        sku,
        depot,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
