import test from "node:test";
import assert from "node:assert/strict";

import { allocateOrder } from "../src/lib/scm-dashboard/cjAllocate.ts";
import {
  parseFbaRows,
  validateShipmentRows,
  type CjStockLookup,
  type FbaShipmentRow,
} from "../src/lib/scm-dashboard/cjValidation.ts";
import type { CjLotStockRow } from "../src/lib/scm-dashboard/cjTypes.ts";

function stockRow(overrides: Partial<CjLotStockRow>): CjLotStockRow {
  return {
    created_at: "",
    updated_at: "",
    close_date: "2026-07-01",
    depot_code: "D1",
    lot_no: "L1",
    production_date: null,
    expiration_date: "2027-01-01",
    resource_code: "BA00021",
    resource_name: "Item",
    barcode: "",
    stock_qty: 100,
    available_qty: 100,
    hold_qty: 0,
    allocated_qty: 0,
    units_per_box: 10,
    boxes_per_pallet: null,
    units_per_pallet: null,
    ...overrides,
  };
}

function shipmentRow(overrides: Partial<FbaShipmentRow>): FbaShipmentRow {
  return {
    rowNumber: 2,
    reference_number: "REF1",
    shipment_id: "FBA123",
    fc: "ABE2",
    address: "123 Main St City ST 12345",
    alt_address: "",
    ship_method: "SPD",
    sku: "BA00021",
    product_name: "Item",
    box_id_range: "1-10",
    qty: 100,
    expiry_display: "2027-01-01",
    expiry_norm: "20270101",
    box_start: 1,
    box_end: 10,
    box_count: 10,
    box_unit: 10,
    declared_box_count: 10,
    box_prefix: "",
    box_num_width: 1,
    fulfillment_type: "FBA",
    validation_status: "ok",
    validation_messages: [],
    ...overrides,
  };
}

const noopLookup: CjStockLookup = {
  boxUnitOf: () => 10,
  skuExists: () => true,
  expiriesOf: () => ["20270101"],
};

test("allocation matches SKUs case-insensitively between upload and CJ stock", () => {
  // Stock stores lowercase prodCd; upload SKU comes in uppercase via parse.
  const stock = [stockRow({ resource_code: "ba00021" })];
  const result = allocateOrder([shipmentRow({})], stock, null);
  assert.equal(result.allocatedEa, 100);
  assert.equal(result.shortageEa, 0);
});

test("parseFbaRows normalizes SKU case at the boundary", () => {
  const rows = parseFbaRows(
    [{ "FBA Shipment ID": "FBA123", SKU: "ba00021", "Box ID": "1-2", QTY: "20" }],
    noopLookup,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "BA00021");
});

test("selected lots are keyed by SKU|expiry|lot so shared lot numbers don't collide", () => {
  // Two SKUs share lot number L1 at the same expiry.
  const stock = [
    stockRow({ resource_code: "BA00021", lot_no: "L1", available_qty: 100 }),
    stockRow({ resource_code: "BA00022", lot_no: "L1", available_qty: 100 }),
  ];
  const rows = [
    shipmentRow({ sku: "BA00021", qty: 100 }),
    shipmentRow({ sku: "BA00022", qty: 100, box_id_range: "11-20", box_start: 11, box_end: 20 }),
  ];
  // Only BA00021's L1 is selected — BA00022 must NOT be allocated even though
  // its lot number string is identical.
  const selected = new Set(["BA00021|20270101|L1"]);
  const result = allocateOrder(rows, stock, selected);
  assert.equal(result.allocatedEa, 100);
  assert.equal(result.shortageEa, 100);
  assert.ok(result.allocations.every((a) => a.sku === "BA00021"));
});

test("continuity validation stays fast on absurd box ranges and reports gaps", () => {
  // A typo'd giant range must not hang (used to materialize every id in a Set).
  const giant = [shipmentRow({ box_id_range: "1-99999999", box_start: 1, box_end: 99_999_999, declared_box_count: 0 })];
  const started = Date.now();
  validateShipmentRows(giant, noopLookup, false);
  assert.ok(Date.now() - started < 2_000, "giant range validation must not hang");

  // Gap reporting still works: 1-3 and 7-8 → missing 4, 5, 6.
  const gappy = [
    shipmentRow({ box_id_range: "1-3", box_start: 1, box_end: 3, qty: 30, declared_box_count: 3 }),
    shipmentRow({ box_id_range: "7-8", box_start: 7, box_end: 8, qty: 20, declared_box_count: 2 }),
  ];
  const validated = validateShipmentRows(gappy, noopLookup, false);
  const messages = validated.flatMap((r) => r.validation_messages).join(" / ");
  assert.match(messages, /\[D\] BoxID 불연속: 누락된 번호 \[4, 5, 6\]/);
});
