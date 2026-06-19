import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchAmazonStockSummary } from "@/lib/scm-dashboard/amazonStockQueries";

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const center = url.searchParams.get("center");
  const requestedSource = url.searchParams.get("source");
  const source = requestedSource === "legacy" ? "legacy" : "new";

  try {
    const payload = await fetchAmazonStockSummary({
      date,
      center,
      limit: Number(url.searchParams.get("limit") ?? 5000),
      source,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Amazon stock summary" },
      { status: 500 },
    );
  }
}
