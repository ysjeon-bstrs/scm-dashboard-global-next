import test from "node:test";
import assert from "node:assert/strict";

import { transformOceanSheetValues, summarizeOceanImportRows } from "../src/lib/scm-dashboard/logisticsSettlement/oceanImport.ts";

const headers = [
  "invoice_date",
  "BL_no",
  "country",
  "charge_type",
  "currency",
  "amount_orig",
  "exrate",
  "amount_krw",
  "tax",
  "POL",
  "POD",
  "vessel",
  "weight_kg",
  "cbm",
  "container_type",
  "packages",
  "file_name",
  "file_id",
];

test("transformOceanSheetValues normalizes dated ocean rows and stable raw keys", () => {
  const rows = transformOceanSheetValues(
    [
      headers,
      ["2026. 3. 20", "COKR26001659", "KR", "OCEAN", "KRW", "₩1,000", "1", "1000", "100", "BUSAN", "LA", "VESSEL", "2000", "12.5", "40HQ", "10", "invoice.pdf", "file-1"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ],
    { spreadsheetId: "sheet-1", sheetName: "해상_정산", etlRunId: "run-1" },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw_key, "sheet:sheet-1:해상_정산:2");
  assert.equal(rows[0].invoice_date, "2026-03-20");
  assert.equal(rows[0].bl_no, "COKR26001659");
  assert.equal(rows[0].amount_orig, 1000);
  assert.equal(rows[0].tax_krw, 100);
  assert.equal(rows[0].etl_run_id, "run-1");
});

test("summarizeOceanImportRows reports BL and charge totals", () => {
  const rows = transformOceanSheetValues(
    [
      headers,
      ["2026-03-20", "BL1", "KR", "OCEAN", "KRW", "1000", "1", "1000", "100", "", "", "", "", "", "", "", "", ""],
      ["2026-03-20", "BL1", "KR", "DUTY", "USD", "50", "1300", "0", "0", "", "", "", "", "", "", "", "", ""],
      ["2026-03-21", "BL2", "US", "TRUCKING", "USD", "20", "1300", "26000", "0", "", "", "", "", "", "", "", "", ""],
    ],
    { spreadsheetId: "sheet-1", sheetName: "해상_정산", etlRunId: "run-1" },
  );

  const summary = summarizeOceanImportRows(rows, { sourceRows: 3, spreadsheetId: "sheet-1", sheetName: "해상_정산" });

  assert.equal(summary.parsedRowCount, 3);
  assert.equal(summary.validRowCount, 3);
  assert.equal(summary.affectedBlCount, 2);
  assert.equal(summary.amountTotals.amountKrw, 27000);
  assert.equal(summary.amountTotals.taxKrw, 100);
  assert.deepEqual(summary.amountTotals.byChargeType, { DUTY: 0, OCEAN: 1000, TRUCKING: 26000 });
});
