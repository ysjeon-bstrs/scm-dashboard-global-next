import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCjWmsRows,
  formatCjOmsOrderDate,
  type LotAllocation,
} from "../src/lib/scm-dashboard/cjAllocate.ts";
import type { FbaShipmentRow } from "../src/lib/scm-dashboard/cjValidation.ts";

test("formats CJ OMS order date like the new Excel template", () => {
  assert.equal(formatCjOmsOrderDate(new Date(2026, 5, 16, 14, 52)), "6/16/26");
});

test("CJ WMS rows include FBA .pdf file name and 주문일시 columns", () => {
  const allocations: LotAllocation[] = [
    {
      shipment_id: "FBA19G6G81LN",
      fc: "LAX9",
      sku: "BA00059_SET01",
      expiry_display: "2027-12-31",
      lot: "LDB",
      allocated_qty: 18,
      allocated_boxes: 1,
      box_start: 1,
      box_end: 1,
      is_mixed: false,
    },
  ];

  const rows: FbaShipmentRow[] = [
    {
      rowNumber: 2,
      reference_number: "MV11050303202606-59-LAX9",
      shipment_id: "FBA19G6G81LN",
      fc: "LAX9",
      address: "11263 Oleander Ave – FONTANA, CA 92337",
      alt_address: "",
      ship_method: "SPD",
      sku: "BA00059_SET01",
      product_name: "이퀄베리-(SET)NAD+펩타이드부스팅크림[50ml|2EA/NAD+펩타이드]",
      box_id_range: "1-1",
      qty: 18,
      expiry_display: "2027-12-31",
      expiry_norm: "20271231",
      box_start: 1,
      box_end: 1,
      box_count: 1,
      box_unit: 18,
      declared_box_count: 1,
      box_prefix: "",
      box_num_width: 6,
      fulfillment_type: "FBA",
      validation_status: "ok",
      validation_messages: [],
    },
  ];

  const [wmsRow] = buildCjWmsRows(allocations, rows, new Date(2026, 5, 16, 14, 52));

  assert.equal(wmsRow.주문번호, "FBA19G6G81LNU000001");
  assert.equal(wmsRow.FBA, "FBA19G6G81LNU000001.pdf");
  assert.equal(wmsRow.주문일시, "6/16/26");
});
