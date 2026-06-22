import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { buildJobActionResponse, buildLogisticsEtlRunId } from "@/lib/scm-dashboard/logisticsSettlement/jobTypes";
import { runOceanRecompute } from "@/lib/scm-dashboard/logisticsSettlement/oceanRecompute";

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.error === "forbidden-domain") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    apply?: boolean;
    month?: string;
    limit?: number;
    confirmation?: string;
  };
  const etlRunId = buildLogisticsEtlRunId(body.apply ? "logistics_settlement_ocean_recompute_apply" : "logistics_settlement_ocean_recompute_dry_run");

  if (body.apply && body.confirmation !== "APPLY_OCEAN_RECOMPUTE") {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "RECOMPUTE",
        status: "BLOCKED",
        summary: null,
        errors: [{ code: "CONFIRMATION_REQUIRED", message: "Set confirmation to APPLY_OCEAN_RECOMPUTE to write mart rows." }],
      }),
      { status: 400 },
    );
  }

  try {
    const summary = await runOceanRecompute({
      apply: body.apply ?? false,
      month: body.month,
      limit: body.limit,
      etlRunId,
    });
    const warnings = summary.warningCount > 0
      ? [{ code: "ALLOCATION_WARNINGS", message: `${summary.warningCount} allocation warnings detected.`, details: summary.warningSamples }]
      : [];
    return NextResponse.json(buildJobActionResponse({ etlRunId, mode: "ocean", step: "RECOMPUTE", summary, warnings }));
  } catch (error) {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "RECOMPUTE",
        summary: null,
        errors: [{ code: "RECOMPUTE_FAILED", message: error instanceof Error ? error.message : "Unknown error" }],
      }),
      { status: 500 },
    );
  }
}
