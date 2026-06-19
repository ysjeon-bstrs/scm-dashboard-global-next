import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmazonDohSummary,
  type AmazonDohSummaryRow,
} from "../src/lib/scm-dashboard/amazonDohQueries.ts";

const rows: AmazonDohSummaryRow[] = [
  {
    raw_key: "a",
    snapshot_date: "2026-06-17",
    sales_window_end_date: "2026-06-16",
    center: "AMZUS",
    resource_code: "BA00031",
    resource_name: "Mask",
    stock_sellable: 4820,
    stock_available: 4818,
    pending_fc: 2,
    stock_incoming: 0,
    stock_expected: 0,
    stock_processing: 0,
    stock_readytoship: 0,
    customer_order: 68,
    qty_1d: 165,
    qty_7d: 1132,
    qty_30d: 2901,
    qty_90d: 3760,
    vel_7d: 161.7143,
    vel_30d: 96.7,
    vel_90d: 41.7778,
    doh_7d: 29.81,
    doh_30d: 49.84,
    doh_90d: 115.37,
    target_days: 45,
    warn_days: 40,
    danger_days: 35,
    fee_risk_days: 28,
    required_qty_gross: 2458,
    required_qty_net: 2458,
    recommended_ship_qty: 2458,
    gap_45d: -2457,
    status: "CRITICAL_SEND_NOW",
    fee_risk: false,
    urgency_rank: 1,
    action_label: "지금 발송 필요",
    action_reason: "위험일수 미만",
    etl_run_id: "run",
  },
  {
    raw_key: "b",
    snapshot_date: "2026-06-17",
    sales_window_end_date: "2026-06-16",
    center: "AMZUS",
    resource_code: "BA00059_SET01",
    resource_name: "Cream set",
    stock_sellable: 4398,
    stock_available: 4360,
    pending_fc: 38,
    stock_incoming: 3024,
    stock_expected: 3006,
    stock_processing: 18,
    stock_readytoship: 0,
    customer_order: 60,
    qty_1d: 125,
    qty_7d: 795,
    qty_30d: 2791,
    qty_90d: 5569,
    vel_7d: 113.5714,
    vel_30d: 93.0333,
    vel_90d: 61.8778,
    doh_7d: 38.72,
    doh_30d: 47.27,
    doh_90d: 71.08,
    target_days: 45,
    warn_days: 40,
    danger_days: 35,
    fee_risk_days: 28,
    required_qty_gross: 713,
    required_qty_net: 0,
    recommended_ship_qty: 0,
    gap_45d: 2311,
    status: "WATCH_INCOMING",
    fee_risk: false,
    urgency_rank: 4,
    action_label: "입고 진행 중, 모니터링",
    action_reason: "입고 반영 후 커버",
    etl_run_id: "run",
  },
  {
    raw_key: "c",
    snapshot_date: "2026-06-17",
    sales_window_end_date: "2026-06-16",
    center: "AMZDE",
    resource_code: "BA00022",
    resource_name: "Serum",
    stock_sellable: 676,
    stock_available: 676,
    pending_fc: 0,
    stock_incoming: 0,
    stock_expected: 0,
    stock_processing: 0,
    stock_readytoship: 0,
    customer_order: 15,
    qty_1d: 15,
    qty_7d: 103,
    qty_30d: 292,
    qty_90d: 661,
    vel_7d: 14.7143,
    vel_30d: 9.7333,
    vel_90d: 7.3444,
    doh_7d: 45.94,
    doh_30d: 69.45,
    doh_90d: 92.04,
    target_days: 45,
    warn_days: 40,
    danger_days: 35,
    fee_risk_days: 28,
    required_qty_gross: 0,
    required_qty_net: 0,
    recommended_ship_qty: 0,
    gap_45d: 14,
    status: "OK",
    fee_risk: false,
    urgency_rank: 5,
    action_label: "정상",
    action_reason: "목표 충족",
    etl_run_id: "run",
  },
];

test("builds decision-first Amazon DOH summary for a selected center", () => {
  const summary = buildAmazonDohSummary(rows, { selectedCenter: "AMZUS" });

  assert.equal(summary.meta.snapshot_date, "2026-06-17");
  assert.equal(summary.meta.sales_window_end_date, "2026-06-16");
  assert.equal(summary.meta.selected_center, "AMZUS");
  assert.equal(summary.meta.row_count, 2);
  assert.equal(summary.totals.send_now_count, 1);
  assert.equal(summary.totals.watch_incoming_count, 1);
  assert.equal(summary.totals.total_required_net, 2458);
  assert.equal(summary.totals.total_recommended_ship_qty, 2458);
  assert.equal(summary.centers.find((center) => center.center === "AMZUS")?.recommended_ship_qty, 2458);
  assert.deepEqual(summary.actions.map((row) => row.resource_code), ["BA00031", "BA00059_SET01"]);
});

test("supports All scope while preserving center summaries", () => {
  const summary = buildAmazonDohSummary(rows, { selectedCenter: "ALL" });

  assert.equal(summary.meta.row_count, 3);
  assert.equal(summary.centers.length, 2);
  assert.equal(summary.totals.send_now_count, 1);
  assert.equal(summary.totals.ok_count, 1);
  assert.equal(summary.actions[0].resource_code, "BA00031");
});
