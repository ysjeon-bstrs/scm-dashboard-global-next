import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmazonSalesRawKey,
  resolveAmazonSalesCenter,
  transformAmazonSalesRows,
  type AmazonSalesRawRow,
} from "../src/lib/scm-dashboard/amazonSalesEtl.ts";

test("maps Amazon marketplace IDs to SCM centers", () => {
  assert.equal(resolveAmazonSalesCenter("ATVPDKIKX0DER", null), "AMZUS");
  assert.equal(resolveAmazonSalesCenter("A1F83G8C2ARO7P", null), "AMZUK");
  assert.equal(resolveAmazonSalesCenter("A1PA6795UKMFR9", null), "AMZDE");
  assert.equal(resolveAmazonSalesCenter("A2VIGQ35RCS4UG", null), "AMZAE");
  assert.equal(resolveAmazonSalesCenter("unknown", "US"), "AMZUS");
  assert.equal(
    resolveAmazonSalesCenter(
      "A1F83G8C2ARO7P,A1PA6795UKMFR9,A2VIGQ35RCS4UG",
      null,
      "Amazon.co.uk",
    ),
    "AMZUK",
  );
  assert.equal(
    resolveAmazonSalesCenter(
      "A1F83G8C2ARO7P,A1PA6795UKMFR9,A2VIGQ35RCS4UG",
      null,
      "Amazon.de",
    ),
    "AMZDE",
  );
  assert.equal(
    resolveAmazonSalesCenter(
      "A1F83G8C2ARO7P,A1PA6795UKMFR9,A2VIGQ35RCS4UG",
      null,
      "Amazon.ae",
    ),
    "AMZAE",
  );
});

test("aggregates Amazon daily sales by PT date, center, channel, ASIN, and SKU", () => {
  const rawRows: AmazonSalesRawRow[] = [
    {
      order_date_pt: "2026-06-16",
      marketplaceid: "ATVPDKIKX0DER",
      sales_channel: "Amazon.com",
      asin: "B0TESTASIN1",
      resource_code: "BA00022",
      resource_name: "Serum",
      order_status: "Shipped",
      quantity: 2,
      order_id: "ORDER-1",
      detail_id: 101,
      purchase_at: "2026-06-16T17:12:00.000Z",
    },
    {
      order_date_pt: "2026-06-16",
      marketplaceid: "ATVPDKIKX0DER",
      sales_channel: "Amazon.com",
      asin: "B0TESTASIN1",
      resource_code: "BA00022",
      resource_name: "Serum",
      order_status: "Unshipped",
      quantity: "3",
      order_id: "ORDER-2",
      detail_id: 102,
      purchase_at: "2026-06-16T22:00:00.000Z",
    },
    {
      order_date_pt: "2026-06-15",
      marketplaceid: "A1F83G8C2ARO7P",
      sales_channel: "Amazon.co.uk",
      asin: "B0TESTASIN1",
      resource_code: "BA00022",
      resource_name: "Serum",
      order_status: "Shipped",
      quantity: 1,
      order_id: "ORDER-3",
      detail_id: 201,
      purchase_at: "2026-06-15T10:00:00.000Z",
    },
  ];

  const rows = transformAmazonSalesRows(rawRows, "run-1");

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => ({
      order_date_pt: row.order_date_pt,
      center: row.center,
      marketplaceid: row.marketplaceid,
      sales_channel: row.sales_channel,
      asin: row.asin,
      resource_code: row.resource_code,
      qty_total: row.qty_total,
      qty_shipped: row.qty_shipped,
      qty_unshipped: row.qty_unshipped,
      source_order_count: row.source_order_count,
      source_detail_count: row.source_detail_count,
    })),
    [
      {
        order_date_pt: "2026-06-15",
        center: "AMZUK",
        marketplaceid: "A1F83G8C2ARO7P",
        sales_channel: "Amazon.co.uk",
        asin: "B0TESTASIN1",
        resource_code: "BA00022",
        qty_total: 1,
        qty_shipped: 1,
        qty_unshipped: 0,
        source_order_count: 1,
        source_detail_count: 1,
      },
      {
        order_date_pt: "2026-06-16",
        center: "AMZUS",
        marketplaceid: "ATVPDKIKX0DER",
        sales_channel: "Amazon.com",
        asin: "B0TESTASIN1",
        resource_code: "BA00022",
        qty_total: 5,
        qty_shipped: 2,
        qty_unshipped: 3,
        source_order_count: 2,
        source_detail_count: 2,
      },
    ],
  );
});

test("skips unmapped ASIN rows and produces stable raw keys", () => {
  const rows = transformAmazonSalesRows(
    [
      {
        order_date_pt: "2026-06-16",
        marketplaceid: "ATVPDKIKX0DER",
        sales_channel: "Amazon.com",
        asin: "B0UNMAPPED",
        resource_code: null,
        resource_name: null,
        order_status: "Shipped",
        quantity: 2,
        order_id: "ORDER-1",
        detail_id: 101,
        purchase_at: "2026-06-16T17:12:00.000Z",
      },
      {
        order_date_pt: "2026-06-16",
        marketplaceid: "ATVPDKIKX0DER",
        sales_channel: "Amazon.com",
        asin: "B0MAPPED",
        resource_code: "BA00022",
        resource_name: "Serum",
        order_status: "Shipped",
        quantity: 2,
        order_id: "ORDER-2",
        detail_id: 102,
        purchase_at: "2026-06-16T18:00:00.000Z",
      },
    ],
    "run-1",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw_key, buildAmazonSalesRawKey(rows[0]));
});
