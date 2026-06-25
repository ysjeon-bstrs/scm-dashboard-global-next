import test from "node:test";
import assert from "node:assert/strict";

import { buildJobActionResponse, mapWarningsToStatus } from "../src/lib/scm-dashboard/logisticsSettlement/jobTypes.ts";

test("buildJobActionResponse returns a stable job envelope", () => {
  const response = buildJobActionResponse({
    etlRunId: "logistics_settlement_ocean_recompute_20260622T010000Z",
    mode: "ocean",
    step: "RECOMPUTE",
    summary: { parsedRowCount: 2 },
    warnings: [{ code: "DUPLICATE_RAW_KEY", message: "Duplicate row" }],
  });

  assert.equal(response.ok, true);
  assert.equal(response.mode, "ocean");
  assert.equal(response.step, "RECOMPUTE");
  assert.equal(response.status, "SUCCEEDED_WITH_WARNINGS");
  assert.equal(response.warnings.length, 1);
  assert.deepEqual(response.errors, []);
  assert.match(response.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("mapWarningsToStatus fails closed when errors are present", () => {
  assert.equal(mapWarningsToStatus([], []), "SUCCEEDED");
  assert.equal(mapWarningsToStatus([{ code: "WARN", message: "warning" }], []), "SUCCEEDED_WITH_WARNINGS");
  assert.equal(mapWarningsToStatus([], [{ code: "ERROR", message: "error" }]), "FAILED");
});
