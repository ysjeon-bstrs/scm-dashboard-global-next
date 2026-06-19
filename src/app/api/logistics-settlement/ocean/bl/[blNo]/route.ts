import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchOceanBlDrilldown } from "@/lib/scm-dashboard/logisticsSettlement/queries";

type RouteContext = {
  params: Promise<{ blNo: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { blNo } = await context.params;
    const drilldown = await fetchOceanBlDrilldown(decodeURIComponent(blNo));
    return NextResponse.json(drilldown);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
