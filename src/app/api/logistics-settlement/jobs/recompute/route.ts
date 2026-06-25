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

  if (body.apply && body.month) {
    // Month-scoped apply is disabled: stale-row cleanup only runs on full runs (a
    // month-scoped run can't see BLs that straddle the onboard/invoice month boundary),
    // so a month apply would leave/strand stale mart rows. Month runs are dry-run only.
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "RECOMPUTE",
        status: "BLOCKED",
        summary: null,
        errors: [{ code: "MONTH_SCOPED_APPLY_DISABLED", message: "Month-scoped apply is disabled. Clear the month and run a full apply (cleanup runs on full runs only); use a month only for dry-run review." }],
      }),
      { status: 400 },
    );
  }

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
