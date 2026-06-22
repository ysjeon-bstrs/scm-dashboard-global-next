import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { buildJobActionResponse, buildLogisticsEtlRunId } from "@/lib/scm-dashboard/logisticsSettlement/jobTypes";
import { runOceanRecompute } from "@/lib/scm-dashboard/logisticsSettlement/oceanRecompute";

type ValidationCheck = {
  code: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  actual?: number | string;
  message: string;
};

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.error === "forbidden-domain") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { month?: string; limit?: number };
  const etlRunId = buildLogisticsEtlRunId("logistics_settlement_ocean_validate");

  try {
    const recompute = await runOceanRecompute({
      apply: false,
      month: body.month,
      limit: body.limit,
      etlRunId,
    });
    const checks: ValidationCheck[] = [
      {
        code: "SETTLEMENT_ROWS_PRESENT",
        label: "해상 정산 원천 row",
        status: recompute.settlementRowCount > 0 ? "PASS" : "FAIL",
        actual: recompute.settlementRowCount,
        message: recompute.settlementRowCount > 0 ? "stg_settlement_ocean_lines rows are available." : "No ocean settlement staging rows found.",
      },
      {
        code: "MOVEMENT_ROWS_PRESENT",
        label: "해상 이동 원장 row",
        status: recompute.movementRowCount > 0 ? "PASS" : "FAIL",
        actual: recompute.movementRowCount,
        message: recompute.movementRowCount > 0 ? "Ocean movement rows are available." : "No ocean movement rows found for this scope.",
      },
      {
        code: "ALLOCATION_ROWS_PRESENT",
        label: "SKU 배부 row",
        status: recompute.allocationRowCount > 0 ? "PASS" : "FAIL",
        actual: recompute.allocationRowCount,
        message: recompute.allocationRowCount > 0 ? "Allocation produced SKU rows." : "Allocation produced no SKU rows.",
      },
      {
        code: "ALLOCATION_WARNINGS",
        label: "배부 warning",
        status: recompute.warningCount === 0 ? "PASS" : "WARN",
        actual: recompute.warningCount,
        message: recompute.warningCount === 0 ? "No allocation warnings." : "Review allocation warning samples before applying.",
      },
      {
        code: "POSITIVE_TOTAL_COST",
        label: "총 배부 물류비",
        status: recompute.totals.logisticsKrw > 0 ? "PASS" : "WARN",
        actual: recompute.totals.logisticsKrw,
        message: recompute.totals.logisticsKrw > 0 ? "Allocated logistics cost is positive." : "Allocated logistics cost is zero for this scope.",
      },
    ];
    const failed = checks.filter((check) => check.status === "FAIL");
    const warned = checks.filter((check) => check.status === "WARN");
    const summary = { passed: failed.length === 0, checks, recompute };
    return NextResponse.json(buildJobActionResponse({
      etlRunId,
      mode: "ocean",
      step: "VALIDATE",
      summary,
      warnings: warned.map((check) => ({ code: check.code, message: check.message, details: check })),
      errors: failed.map((check) => ({ code: check.code, message: check.message, details: check })),
    }));
  } catch (error) {
    return NextResponse.json(
      buildJobActionResponse({
        etlRunId,
        mode: "ocean",
        step: "VALIDATE",
        summary: null,
        errors: [{ code: "VALIDATE_FAILED", message: error instanceof Error ? error.message : "Unknown error" }],
      }),
      { status: 500 },
    );
  }
}
