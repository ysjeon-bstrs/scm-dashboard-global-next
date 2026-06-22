import test from "node:test";
import assert from "node:assert/strict";

import { summarizeOceanStagingRows } from "../src/lib/scm-dashboard/logisticsSettlement/stagingStatus.ts";

test("summarizeOceanStagingRows reports row, BL, file, and amount totals", () => {
  const summary = summarizeOceanStagingRows([
    {
      raw_key: "sheet:s:해상_정산:2",
      invoice_date: "2026-03-01",
      bl_no: "BL1",
      charge_type: "OCEAN",
      amount_krw: 1000,
      tax_krw: 100,
      file_id: "file-1",
      file_name: "20260301_CJ_KR_BL1.pdf",
      updated_at: "2026-06-01T00:00:00Z",
    },
    {
      raw_key: "sheet:s:해상_정산:3",
      invoice_date: "2026-03-02",
      bl_no: "BL1",
      charge_type: "DUTY",
      amount_krw: 0,
      tax_krw: 0,
      file_id: "file-1",
      file_name: "20260301_CJ_KR_BL1.pdf",
      updated_at: "2026-06-02T00:00:00Z",
    },
    {
      raw_key: "sheet:s:해상_정산:4",
      invoice_date: "2026-04-01",
      bl_no: "BL2",
      charge_type: "TRUCKING",
      amount_krw: 2000,
      tax_krw: 200,
      file_id: "",
      file_name: "manual.xlsx",
      updated_at: "2026-06-03T00:00:00Z",
    },
  ]);

  assert.equal(summary.rowCount, 3);
  assert.equal(summary.blCount, 2);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.latestUpdatedAt, "2026-06-03T00:00:00Z");
  assert.deepEqual(summary.months, ["2026-03", "2026-04"]);
  assert.equal(summary.amountTotals.amountKrw, 3000);
  assert.equal(summary.amountTotals.taxKrw, 300);
  assert.deepEqual(summary.amountTotals.byChargeType, { DUTY: 0, OCEAN: 1000, TRUCKING: 2000 });
});
