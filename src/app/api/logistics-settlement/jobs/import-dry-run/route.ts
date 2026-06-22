import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { buildJobActionResponse, buildLogisticsEtlRunId } from "@/lib/scm-dashboard/logisticsSettlement/jobTypes";
import { runOceanSheetImport } from "@/lib/scm-dashboard/logisticsSettlement/oceanImport";

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.error === "forbidden-domain") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    spreadsheetId?: string;
    sheetName?: string;
    range?: string;
    limit?: number;
  };
  const etlRunId = buildLogisticsEtlRunId("logistics_settlement_ocean_import_dry_run");

  try {
    const summary = await runOceanSheetImport({
      apply: false,
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName,
      range: body.range,
      limit: body.limit,
      etlRunId,
    });
    const warnings = summary.duplicateRawKeyCount > 0
      ? [{ code: "DUPLICATE_RAW_KEY", message: `${summary.duplicateRawKeyCount} duplicate staging keys detected.` }]
      : [];
    return NextResponse.json(buildJobActionResponse({ etlRunId, mode: "ocean", step: "IMPORT_DRY_RUN", summary, warnings }));
  } catch (error) {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "IMPORT_DRY_RUN",
        summary: null,
        errors: [{ code: "IMPORT_DRY_RUN_FAILED", message: error instanceof Error ? error.message : "Unknown error" }],
      }),
      { status: 500 },
    );
  }
}
