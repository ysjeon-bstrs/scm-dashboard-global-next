import test from "node:test";
import assert from "node:assert/strict";

import { allocateOceanSettlement } from "../src/lib/scm-dashboard/logisticsSettlement/oceanAllocation.ts";
import type {
  GlobalMoveLine,
  OceanSettlementLine,
  SkuMaster,
  UnitPrice,
} from "../src/lib/scm-dashboard/logisticsSettlement/types.ts";

const moves: GlobalMoveLine[] = [
  {
    sourceLineId: 1,
    invoiceNo: "INV1",
    carrier: "CJ",
    carrierMode: "해상",
    shipDate: "2026-05-01",
    fromWarehouse: "KR",
    toWarehouse: "US",
    resourceCode: "BA00021",
    resourceName: "Serum",
    qtyEa: 100,
    qtyCtn: 1,
    unitPriceUsd: 8,
    amountUsd: 800,
    blNo: "BL1",
  },
  {
    sourceLineId: 2,
    invoiceNo: "INV2",
    carrier: "CJ",
    carrierMode: "해상",
    shipDate: "2026-05-01",
    fromWarehouse: "KR",
    toWarehouse: "US",
    resourceCode: "BA00055",
    resourceName: "Cream",
    qtyEa: 50,
    qtyCtn: 1,
    unitPriceUsd: 10,
    amountUsd: 500,
    blNo: "BL1",
  },
];

const settlement: OceanSettlementLine[] = [
  {
    rawKey: "s1",
    invoiceDate: "2026-06-05",
    blNo: "BL1",
    country: "KR",
    chargeType: "OCEAN",
    currency: "KRW",
    amountOrig: 0,
    exrate: 1400,
    amountKrw: 90000,
    taxKrw: 10000,
    containerType: "40DRY",
    fileName: "cj.pdf",
    fileId: "f1",
  },
  {
    rawKey: "s2",
    invoiceDate: "2026-06-07",
    blNo: "BL1",
    country: "US",
    chargeType: "TRUCKING",
    currency: "KRW",
    amountOrig: 0,
    exrate: 1400,
    amountKrw: 50000,
    taxKrw: 0,
    containerType: "40DRY",
    fileName: "cj.pdf",
    fileId: "f1",
  },
  {
    rawKey: "s3",
    invoiceDate: "2026-06-07",
    blNo: "BL1",
    country: "US",
    chargeType: "DUTY",
    currency: "USD",
    amountOrig: 100,
    exrate: 1400,
    amountKrw: 0,
    taxKrw: 0,
    containerType: "40DRY",
    fileName: "cj.pdf",
    fileId: "f1",
  },
];

const skuMasters: SkuMaster[] = [
  { resourceCode: "BA00021", skuWeightG: 100 },
  { resourceCode: "BA00055", skuWeightG: 200 },
];

const unitPrices: UnitPrice[] = [
  { fromCountry: "KR", toCountry: "US", resourceCode: "BA00021", proposalUnitPriceUsd: 8 },
  { fromCountry: "KR", toCountry: "US", resourceCode: "BA00055", proposalUnitPriceUsd: 10 },
];

test("classifies ocean/trucking as freight and duty as USD times FX", () => {
  const result = allocateOceanSettlement({ moves, settlement, skuMasters, unitPrices });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].invoiceTotalFreightKrw, 150000);
  assert.equal(result.rows[0].invoiceTotalDutyKrw, 140000);
  assert.equal(result.rows[0].invoiceTotalLogisticsKrw, 290000);
});

test("allocates freight by weight and duty by declared value", () => {
  const result = allocateOceanSettlement({ moves, settlement, skuMasters, unitPrices });
  const serum = result.rows.find((row) => row.resourceCode === "BA00021")!;
  const cream = result.rows.find((row) => row.resourceCode === "BA00055")!;

  assert.equal(Math.round(serum.weightRatioPct), 50);
  assert.equal(Math.round(cream.weightRatioPct), 50);
  assert.equal(Math.round(serum.valueRatioPct), 62);
  assert.equal(Math.round(cream.valueRatioPct), 38);

  assert.equal(serum.skuFreightUnitKrw, 750);
  assert.equal(cream.skuFreightUnitKrw, 1500);
});

test("per-row bucket allocations sum to logistics and reconcile to the BL total", () => {
  const result = allocateOceanSettlement({ moves, settlement, skuMasters, unitPrices });

  for (const row of result.rows) {
    assert.equal(
      row.skuFreightKrw + row.skuDutyKrw + row.skuOtherKrw,
      row.skuLogisticsAllocKrw,
    );
  }

  const allocatedTotal = result.rows.reduce((sum, row) => sum + row.skuLogisticsAllocKrw, 0);
  assert.equal(allocatedTotal, result.rows[0].invoiceTotalLogisticsKrw);
});

test("preserves DUTY billed directly in KRW (amount_krw) instead of dropping it", () => {
  const krwDutySettlement: OceanSettlementLine[] = [
    { ...settlement[0] },
    {
      ...settlement[2],
      // Duty captured in KRW: no original amount, but amount_krw/tax_krw are set.
      currency: "KRW",
      amountOrig: 0,
      amountKrw: 120000,
      taxKrw: 20000,
    },
  ];

  const result = allocateOceanSettlement({
    moves,
    settlement: krwDutySettlement,
    skuMasters,
    unitPrices,
  });

  assert.equal(result.rows[0].invoiceTotalDutyKrw, 140000);
});

test("warns when a DUTY line has neither amount_krw nor amount_orig", () => {
  const emptyDutySettlement: OceanSettlementLine[] = [
    { ...settlement[0] },
    { ...settlement[2], amountOrig: 0, amountKrw: 0, taxKrw: 0 },
  ];

  const result = allocateOceanSettlement({
    moves,
    settlement: emptyDutySettlement,
    skuMasters,
    unitPrices,
  });

  assert.equal(result.rows[0].invoiceTotalDutyKrw, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "MISSING_DUTY_AMOUNT"));
});

test("falls back to qty basis and reports warnings when weights and prices are missing", () => {
  const result = allocateOceanSettlement({
    moves,
    settlement,
    skuMasters: [],
    unitPrices: [],
  });

  assert.equal(result.rows.length, 2);
  assert.ok(result.warnings.some((warning) => warning.code === "FALLBACK_QTY_WEIGHT"));
  assert.ok(result.warnings.some((warning) => warning.code === "FALLBACK_QTY_DUTY"));
  assert.ok(result.warnings.some((warning) => warning.code === "MISSING_SKU_WEIGHT"));
  assert.ok(result.warnings.some((warning) => warning.code === "MISSING_UNIT_PRICE"));
});
