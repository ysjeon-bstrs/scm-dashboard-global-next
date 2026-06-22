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
    confirmation?: string;
  };
  const etlRunId = buildLogisticsEtlRunId("logistics_settlement_ocean_import_apply");

  if (body.confirmation !== "APPLY_OCEAN_IMPORT") {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "IMPORT_APPLY",
        status: "BLOCKED",
        summary: null,
        errors: [{ code: "CONFIRMATION_REQUIRED", message: "Set confirmation to APPLY_OCEAN_IMPORT to write staging rows." }],
      }),
      { status: 400 },
    );
  }

  try {
    const summary = await runOceanSheetImport({
      apply: true,
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName,
      range: body.range,
      limit: body.limit,
      etlRunId,
    });
    const warnings = summary.duplicateRawKeyCount > 0
      ? [{ code: "DUPLICATE_RAW_KEY", message: `${summary.duplicateRawKeyCount} duplicate staging keys detected.` }]
      : [];
    return NextResponse.json(buildJobActionResponse({ etlRunId, mode: "ocean", step: "IMPORT_APPLY", summary, warnings }));
  } catch (error) {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "IMPORT_APPLY",
        summary: null,
        errors: [{ code: "IMPORT_APPLY_FAILED", message: error instanceof Error ? error.message : "Unknown error" }],
      }),
      { status: 500 },
    );
  }
}
