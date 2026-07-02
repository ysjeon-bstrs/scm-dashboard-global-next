import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sync = readFileSync("scripts/etl/amazon/sync-amazon-doh.ts", "utf-8");

test("DOH velocity reads shipped units, not qty_total (excludes unshipped/pending)", () => {
  assert.match(sync, /resource_name,qty_shipped"/, "sales query must select qty_shipped");
  assert.doesNotMatch(sync, /resource_name,qty_total"/, "must not select qty_total for velocity");
});

test("DOH apply deletes stale same-snapshot rows from a prior run", () => {
  assert.match(sync, /async function deleteStaleRows\(/, "stale-row cleanup must exist");
  assert.match(sync, /etl_run_id", `neq\.\$\{etlRunId\}`/, "cleanup targets other etl_run_id");
  assert.match(sync, /snapshot_date", `eq\.\$\{snapshotDate\}`/, "cleanup scoped to snapshot_date");
  assert.match(sync, /written > 0[\s\S]*?deleteStaleRows\(/, "guarded so empty payload never wipes");
});
