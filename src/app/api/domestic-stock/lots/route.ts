import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchDomesticStockLots } from "@/lib/scm-dashboard/domesticStockQueries";

function getBooleanParam(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;
  return !["0", "false", "no"].includes(value.toLowerCase());
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await fetchDomesticStockLots({
      warehouseCode: request.nextUrl.searchParams.get("warehouse_code") ?? undefined,
      snapshotDate: request.nextUrl.searchParams.get("snapshot_date"),
      productCode:
        request.nextUrl.searchParams.get("product_code") ??
        request.nextUrl.searchParams.get("sku"),
      bucketCode: request.nextUrl.searchParams.get("bucket_code"),
      includeExcluded: getBooleanParam(request.nextUrl.searchParams.get("include_excluded"), true),
      limit: Number(request.nextUrl.searchParams.get("limit") ?? NaN),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
