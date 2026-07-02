import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmazonDohRows,
  getAmazonDohSalesWindowEnd,
  type AmazonDohInventoryInput,
  type AmazonDohSalesInput,
} from "../src/lib/scm-dashboard/amazonDohEtl.ts";

test("uses snapshot_date - 1 as the PT sales window end", () => {
  assert.equal(getAmazonDohSalesWindowEnd("2026-06-17"), "2026-06-16");
});

test("calculates calendar zero-filled velocities and net required quantity", () => {
  const inventory: AmazonDohInventoryInput[] = [
    {
      snapshot_date: "2026-06-17",
      center: "AMZUS",
      resource_code: "BA00022",
      resource_name: null,
      stock_sellable: 100,
      stock_available: 90,
      pending_fc: 10,
      stock_expected: 20,
      stock_processing: 10,
      stock_readytoship: 5,
      customer_order: 2,
    },
  ];
  const sales: AmazonDohSalesInput[] = [
    { order_date_pt: "2026-06-16", center: "AMZUS", resource_code: "BA00022", resource_name: "Serum from sales", qty_shipped: 14 },
    { order_date_pt: "2026-06-14", center: "AMZUS", resource_code: "BA00022", resource_name: "Serum from sales", qty_shipped: 7 },
    { order_date_pt: "2026-06-01", center: "AMZUS", resource_code: "BA00022", resource_name: "Serum from sales", qty_shipped: 30 },
  ];

  const rows = buildAmazonDohRows({ inventory, sales, snapshotDate: "2026-06-17", etlRunId: "run-1" });

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.sales_window_end_date, "2026-06-16");
  assert.equal(row.resource_name, "Serum from sales");
  assert.equal(row.stock_incoming, 35);
  assert.equal(row.qty_1d, 14);
  assert.equal(row.qty_7d, 21);
  assert.equal(row.qty_30d, 51);
  assert.equal(row.vel_7d, 3);
  assert.equal(row.vel_30d, 1.7);
  assert.equal(row.required_qty_gross, 35);
  assert.equal(row.required_qty_net, 0);
  assert.equal(row.recommended_ship_qty, 0);
  assert.equal(row.gap_45d, 0);
  assert.equal(row.status, "WATCH_INCOMING");
  assert.equal(row.action_label, "입고 진행 중, 모니터링");
});

test("excludes configured SKUs entirely and supports non-US centers", () => {
  const inventory: AmazonDohInventoryInput[] = [
    {
      snapshot_date: "2026-06-17",
      center: "AMZUK",
      resource_code: "BA00030",
      resource_name: "Excluded",
      stock_sellable: 1,
      stock_available: 1,
      pending_fc: 0,
      stock_expected: 0,
      stock_processing: 0,
      stock_readytoship: 0,
      customer_order: 0,
    },
    {
      snapshot_date: "2026-06-17",
      center: "AMZDE",
      resource_code: "BA00022",
      resource_name: "Serum",
      stock_sellable: 10,
      stock_available: 10,
      pending_fc: 0,
      stock_expected: 0,
      stock_processing: 0,
      stock_readytoship: 0,
      customer_order: 0,
    },
  ];
  const sales: AmazonDohSalesInput[] = [
    { order_date_pt: "2026-06-16", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-15", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-14", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-13", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-12", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-11", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
    { order_date_pt: "2026-06-10", center: "AMZDE", resource_code: "BA00022", qty_shipped: 14 },
  ];

  const rows = buildAmazonDohRows({ inventory, sales, snapshotDate: "2026-06-17", etlRunId: "run-1" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].center, "AMZDE");
  assert.equal(rows[0].vel_7d, 14);
  assert.equal(rows[0].doh_7d, 0.71);
  assert.equal(rows[0].required_qty_net, 620);
  assert.equal(rows[0].status, "CRITICAL_SEND_NOW");
  assert.equal(rows[0].action_label, "지금 발송 필요");
});
