import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchAcrossbSummary } from "@/lib/scm-dashboard/acrossbQueries";

export async function GET() {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await fetchAcrossbSummary());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
