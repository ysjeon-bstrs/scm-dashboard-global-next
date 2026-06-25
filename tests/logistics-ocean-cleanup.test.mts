import test from "node:test";
import assert from "node:assert/strict";

import { planOceanCleanup } from "../src/lib/scm-dashboard/logisticsSettlement/oceanMart.ts";

test("full recompute (no month, no limit) cleans up the whole ocean_v1 scope", () => {
  const plan = planOceanCleanup({});
  assert.equal(plan.eligible, true);
  assert.equal(plan.scope, "all");
  assert.equal(plan.month, null);
  assert.equal(plan.reason, null);
});

test("month-scoped recompute is NOT eligible for cleanup (deletion-safety guard)", () => {
  // moves are filtered by onboard month, settlement by invoice month, so a month-scoped
  // delete could drop a straddling BL's row without regenerating it. Cleanup is full-run only.
  const plan = planOceanCleanup({ month: "2026-05" });
  assert.equal(plan.eligible, false);
  assert.equal(plan.scope, "month");
  assert.equal(plan.month, "2026-05");
  assert.ok(plan.reason && plan.reason.includes("month-scoped"));
});

test("partial run (limit set) is NOT eligible for cleanup", () => {
  const plan = planOceanCleanup({ limit: 100 });
  assert.equal(plan.eligible, false);
  assert.ok(plan.reason && plan.reason.includes("partial run"));
});

test("limit takes precedence over month: partial month run still skips cleanup", () => {
  const plan = planOceanCleanup({ month: "2026-05", limit: 50 });
  assert.equal(plan.eligible, false);
  // Scope/month are still reported for the preview even when cleanup is skipped.
  assert.equal(plan.scope, "month");
  assert.equal(plan.month, "2026-05");
});
