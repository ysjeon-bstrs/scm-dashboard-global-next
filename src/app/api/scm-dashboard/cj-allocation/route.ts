import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import {
  allocateCjLotsFefo,
  normalizeCjAllocationRequests,
  summarizeCjAllocationNotices,
} from "@/lib/scm-dashboard/cjAllocation";
import { fetchCjLotStocks } from "@/lib/scm-dashboard/cjQueries";
import type { CjAllocationRequestRow } from "@/lib/scm-dashboard/cjTypes";

interface CjAllocationPayload {
  rows?: CjAllocationRequestRow[];
  depot?: string | null;
  latestOnly?: boolean;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as CjAllocationPayload;
    const requestRows = normalizeCjAllocationRequests(payload.rows ?? []).map(
      (row) => ({
        ...row,
        depot_code: row.depot_code ?? payload.depot ?? null,
      }),
    );
    const skus = Array.from(new Set(requestRows.map((row) => row.resource_code)));

    if (requestRows.length === 0 || skus.length === 0) {
      return NextResponse.json({
        rows: [],
        notices: ["No valid allocation request rows were found."],
        meta: {
          requestCount: 0,
          allocationCount: 0,
          skuCount: 0,
          latestOnly: payload.latestOnly !== false,
        },
      });
    }

    const { rows: stocks } = await fetchCjLotStocks({
      limit: Math.max(500, skus.length * 300),
      skus,
      depot: payload.depot ?? null,
      latestOnly: payload.latestOnly !== false,
    });
    const rows = allocateCjLotsFefo(requestRows, stocks);

    return NextResponse.json({
      rows,
      notices: summarizeCjAllocationNotices(rows),
      meta: {
        requestCount: requestRows.length,
        allocationCount: rows.length,
        skuCount: skus.length,
        latestOnly: payload.latestOnly !== false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
