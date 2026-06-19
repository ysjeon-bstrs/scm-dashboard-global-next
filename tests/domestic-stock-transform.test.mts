import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDomesticStockRawKey,
  transformDomesticStockRows,
  type DomesticStockRawRow,
} from "../src/lib/scm-dashboard/domesticStockEtl.ts";

test("builds stable domestic stock raw key from lot-level grain", () => {
  assert.equal(
    buildDomesticStockRawKey({
      snapshot_date: "2026-06-10",
      warehouse_code: "DESIGN_KR",
      product_code: "BA00022",
      lot: "R0",
      expiration_date: "2029-04-07",
      warehouse_lname: "DL_입고",
      location: "C2-01-01-00",
    }),
    "4yAMN7FQ7soFsjsjIxSXVsrzEDwQAXqAGYPlzqlERsA",
  );
});

test("treats DL_입고 as 디자인KR running stock and excludes temporary/waiting buckets", () => {
  const raw: DomesticStockRawRow[] = [
    {
      standard_date: "2026-06-10",
      product_code: "BA00022",
      product_name: "이퀄베리-비타민일루미네이팅세럼[30ml/-]",
      barcode: "8800000000001",
      lot: "R0",
      expiration_date: "2029-04-07",
      warehouse_lname: "DL_입고",
      location: "C2-01-01-00",
      stock_quantity: "100",
      delivery_wait_quantity: "0",
      available_stock_quantity: "100",
    },
    {
      standard_date: "2026-06-10",
      product_code: "BA00022",
      product_name: "이퀄베리-비타민일루미네이팅세럼[30ml/-]",
      barcode: "8800000000001",
      lot: "R1",
      expiration_date: "2029-05-01",
      warehouse_lname: "임시(부스터스)",
      location: "00-00-00-00",
      stock_quantity: "25",
      delivery_wait_quantity: "0",
      available_stock_quantity: "25",
    },
    {
      standard_date: "2026-06-10",
      product_code: "BA00022",
      product_name: "이퀄베리-비타민일루미네이팅세럼[30ml/-]",
      barcode: "8800000000001",
      lot: "R2",
      expiration_date: "2029-06-01",
      warehouse_lname: "입고_대기",
      location: "00-00-00-01",
      stock_quantity: "10",
      delivery_wait_quantity: "0",
      available_stock_quantity: "10",
    },
    {
      standard_date: "2026-06-10",
      product_code: "BR00001",
      product_name: "Non BA item",
      barcode: "8800000000002",
      lot: "R0",
      expiration_date: "2029-04-07",
      warehouse_lname: "DL_입고",
      location: "C2-01-02-00",
      stock_quantity: "999",
      delivery_wait_quantity: "0",
      available_stock_quantity: "999",
    },
  ];

  const result = transformDomesticStockRows(raw, { etlRunId: "test-run" });

  assert.equal(result.rawRows.length, 4);
  assert.equal(result.lotRows.length, 3);
  assert.equal(result.skuRows.length, 1);
  assert.deepEqual(result.skuRows[0], {
    raw_key: "G9yFbgkCaDHjfgPDaGM-XuPVecCmF4GQoTr3JJ91wKo",
    snapshot_date: "2026-06-10",
    warehouse_code: "DESIGN_KR",
    product_code: "BA00022",
    product_name: "이퀄베리-비타민일루미네이팅세럼[30ml/-]",
    stock_running: 100,
    stock_total: 135,
    stock_excluded: 35,
    available_running: 100,
    delivery_wait_quantity: 0,
    lot_count: 3,
    nearest_expiration_date: "2029-04-07",
    etl_run_id: "test-run",
  });
  assert.equal(result.summary.runningStockTotal, 100);
  assert.equal(result.summary.excludedStockTotal, 35);
  assert.equal(result.summary.bucketTotals["DL_입고"].include_in_running_stock, true);
  assert.equal(result.summary.bucketTotals["임시(부스터스)"].include_in_running_stock, false);
});
