import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmzStockRawKey,
  resolveAmazonCenter,
  transformAmazonInventoryRows,
  type AmazonInventoryRawRow,
} from "../src/lib/scm-dashboard/amazonStockEtl.ts";

test("maps marketplace/country to legacy AMZ center codes", () => {
  assert.equal(resolveAmazonCenter("ATVPDKIKX0DER", ""), "AMZUS");
  assert.equal(resolveAmazonCenter("", "UK"), "AMZUK");
  assert.equal(resolveAmazonCenter("A1PA6795UKMFR9", ""), "AMZDE");
  assert.equal(resolveAmazonCenter("", "AE"), "AMZAE");
  assert.equal(resolveAmazonCenter("UNKNOWN", "JP"), null);
});

test("builds Apps Script compatible raw_key from resource_code, center, date", () => {
  assert.equal(
    buildAmzStockRawKey({ resource_code: "BA00001", center: "AMZUS", date: "2026-06-05" }),
    "fenkVJyl11acwhI8JzilRzicu9pkIXk7sG77KiROqio",
  );
});

test("transforms and aggregates raw inventory rows by date center resource_code", () => {
  const raw: AmazonInventoryRawRow[] = [
    {
      marketplaceid: "ATVPDKIKX0DER",
      country: "US",
      resource_code: "BA00001",
      fulfillable_quantity: "10",
      pending_transshipment_quantity: "2",
      inbound_shipped_quantity: "3",
      inbound_receiving_quantity: "4",
      inbound_working_quantity: "5",
      pending_customer_order_quantity: "6",
      fc_processing_quantity: "7",
      asin_list: "ASIN-A",
      latest_updated_at: "2026-06-05T00:00:00Z",
    },
    {
      marketplaceid: "ATVPDKIKX0DER",
      country: "US",
      resource_code: "BA00001",
      fulfillable_quantity: 1,
      pending_transshipment_quantity: 8,
      inbound_shipped_quantity: 0,
      inbound_receiving_quantity: 1,
      inbound_working_quantity: 0,
      pending_customer_order_quantity: 0,
      fc_processing_quantity: 0,
      asin_list: "ASIN-B",
      latest_updated_at: "2026-06-06T00:00:00Z",
    },
    {
      marketplaceid: "UNKNOWN",
      country: "JP",
      resource_code: "BA99999",
      fulfillable_quantity: 100,
    },
  ];

  const rows = transformAmazonInventoryRows(raw, "2026-06-05");

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    raw_key: "fenkVJyl11acwhI8JzilRzicu9pkIXk7sG77KiROqio",
    resource_code: "BA00001",
    center: "AMZUS",
    date: "2026-06-05",
    stock_sellable: 21,
    stock_available: 11,
    pending_fc: 10,
    stock_expected: 3,
    stock_processing: 5,
    stock_readytoship: 5,
    customer_order: 6,
    fc_processing: 7,
    latest_updated_at: "2026-06-06T00:00:00.000Z",
    source_row_count: 2,
    source_max_id: null,
  });
});
