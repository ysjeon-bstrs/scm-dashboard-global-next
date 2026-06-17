import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFbaRows,
  summarizeValidation,
  validateShipmentRows,
  type CjStockLookup,
} from "../src/lib/scm-dashboard/cjValidation.ts";

const lookup: CjStockLookup = {
  boxUnitOf: (sku) => (sku === "BA00022" ? 96 : 0),
  skuExists: (sku) => sku === "BA00022",
  expiriesOf: () => ["20290119"],
};

test("parses CJ order rows that omit FBA Shipment ID but provide Reference Number", () => {
  const rawRows = [
    {
      "Reference Number": "MV11190303202606-08_XD01_ONT1",
      "FBA Shipment ID": "",
      배송센터: "XD01_ONT1",
      배송지주소: "4560 Hamner Ave, Eastvale CA 91752",
      출고방법: "SPD",
      품번: "BA00022",
      품목: "이퀄베리-비타민일루미네이팅세럼[30ml/-]",
      박스ID: "C0001-C0104",
      수량: " 9,984 ",
      박스수량: " 104 ",
      유통기한: "2029-01-19",
    },
  ];

  const rows = parseFbaRows(rawRows, lookup, "FBA");
  const validation = summarizeValidation(validateShipmentRows(rows, lookup, true));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].shipment_id, "MV11190303202606-08_XD01_ONT1");
  assert.equal(rows[0].reference_number, "MV11190303202606-08_XD01_ONT1");
  assert.equal(rows[0].box_start, 1);
  assert.equal(rows[0].box_end, 104);
  assert.equal(rows[0].qty, 9984);
  assert.equal(rows[0].declared_box_count, 104);
  assert.equal(validation.okCount, 1);
  assert.equal(validation.errorCount, 0);
});
