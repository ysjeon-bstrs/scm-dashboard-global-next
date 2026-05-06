import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchInventorySnapshots, fetchLogisticsMoves } from "@/lib/scm-dashboard/queries";
import { createServerSupabaseClient } from "@/lib/scm-dashboard/supabaseClient";
import { createDashboardData } from "@/lib/scm-dashboard/transform";
import type { DashboardFilters } from "@/lib/scm-dashboard/types";

function getArrayParam(request: NextRequest, key: string) {
  return request.nextUrl.searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function getFilters(request: NextRequest): DashboardFilters {
  return {
    centers: getArrayParam(request, "center"),
    skus: getArrayParam(request, "sku"),
    dateFrom: request.nextUrl.searchParams.get("dateFrom"),
    dateTo: request.nextUrl.searchParams.get("dateTo"),
    useTrendForecast: request.nextUrl.searchParams.get("trend") === "true",
    lookbackDays: Number(request.nextUrl.searchParams.get("lookbackDays") ?? 30),
  };
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
    const supabase = await createServerSupabaseClient();
    const [inventoryResult, moveResult] = await Promise.all([
      fetchInventorySnapshots(supabase),
      fetchLogisticsMoves(supabase),
    ]);
    const notices = [inventoryResult.notice, moveResult.notice].filter(
      (notice): notice is string => Boolean(notice),
    );

    return NextResponse.json(
      createDashboardData(
        inventoryResult.rows,
        moveResult.rows,
        getFilters(request),
        notices,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
