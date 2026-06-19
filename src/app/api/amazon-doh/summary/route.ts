import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchAmazonDohSummary } from "@/lib/scm-dashboard/amazonDohQueries";

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const snapshotDate = url.searchParams.get("date");
  const center = url.searchParams.get("center");

  try {
    const payload = await fetchAmazonDohSummary({
      snapshotDate,
      center,
      limit: Number(url.searchParams.get("limit") ?? 5000),
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Amazon DOH summary" },
      { status: 500 },
    );
  }
}
