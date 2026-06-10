import test from "node:test";
import assert from "node:assert/strict";

import JSZip from "jszip";

import {
  buildCombinedFbaLabelZip,
  compareCjOmsOrderIdsWithPdfBoxIds,
  extractCjOmsOrderIdsFromRows,
  extractFbaBoxIdsFromText,
  findCrossPdfDuplicateBoxIds,
  getCombinedFbaLabelZipFileName,
  hasSequentialFbaBoxIds,
  type FbaLabelParseResult,
} from "../src/lib/scm-dashboard/fbaLabelZip.ts";

function fakeResult(slotId: string, ids: string[]): FbaLabelParseResult {
  return {
    slotId,
    fileName: `${slotId}.pdf`,
    pageCount: ids.length,
    rows: ids.map((boxId, index) => ({
      page: index + 1,
      boxId,
      sequence: Number(boxId.match(/U(\d{6})$/)?.[1] ?? 0),
      status: "ok",
      messages: [],
    })),
    pageFiles: ids.map((boxId) => ({
      boxId,
      bytes: new Uint8Array([80, 68, 70]),
    })),
    errors: [],
    warnings: [],
  };
}

test("extracts exact page-level FBA box IDs", () => {
  assert.deepEqual(
    extractFbaBoxIdsFromText("Created ... FBA19DZ63LQ0U000001 Single SKU"),
    ["FBA19DZ63LQ0U000001"],
  );
});

test("does not accept shipment-level FBA prefix without box sequence", () => {
  assert.deepEqual(extractFbaBoxIdsFromText("Shipment FBA19DZ63LQ0"), []);
});

test("extracts CJ OMS order IDs from the strict 주문번호 column only", () => {
  assert.deepEqual(
    extractCjOmsOrderIdsFromRows([
      { 주문번호: "FBA19219ZXCOU000001", other: "ignored" },
      { 주문번호: "FBA19219ZXCOU000002" },
    ]),
    ["FBA19219ZXCOU000001", "FBA19219ZXCOU000002"],
  );

  assert.throws(
    () => extractCjOmsOrderIdsFromRows([{ "주문 번호": "FBA19219ZXCOU000001" }]),
    /주문번호 컬럼이 없습니다/,
  );
});

test("does not normalize malformed order IDs with .pdf suffix", () => {
  assert.throws(
    () => extractCjOmsOrderIdsFromRows([{ 주문번호: "FBA19219ZXCOU000001.pdf" }]),
    /\.pdf가 포함되어 있습니다/,
  );
});

test("detects sequential FBA box IDs in page order", () => {
  assert.equal(
    hasSequentialFbaBoxIds([
      "FBA19DZ63LQ0U000001",
      "FBA19DZ63LQ0U000002",
      "FBA19DZ63LQ0U000003",
    ]),
    true,
  );

  assert.equal(
    hasSequentialFbaBoxIds([
      "FBA19DZ63LQ0U000001",
      "FBA19DZ63LQ0U000003",
    ]),
    false,
  );
});

test("finds duplicate box IDs across uploaded PDF results", () => {
  const duplicates = findCrossPdfDuplicateBoxIds([
    fakeResult("slot-1", ["FBA19DZ63LQ0U000001", "FBA19DZ63LQ0U000002"]),
    fakeResult("slot-2", ["FBA19DZ41HYBU000001", "FBA19DZ63LQ0U000002"]),
  ]);

  assert.deepEqual([...duplicates], ["FBA19DZ63LQ0U000002"]);
});

test("compares strict CJ OMS order IDs with PDF box IDs", () => {
  const comparison = compareCjOmsOrderIdsWithPdfBoxIds(
    ["FBA19DZ63LQ0U000001", "FBA19DZ63LQ0U000002"],
    ["FBA19DZ63LQ0U000002", "FBA19DZ41HYBU000001"],
  );

  assert.deepEqual(comparison.matched, ["FBA19DZ63LQ0U000002"]);
  assert.deepEqual(comparison.missingInPdf, ["FBA19DZ63LQ0U000001"]);
  assert.deepEqual(comparison.extraInPdf, ["FBA19DZ41HYBU000001"]);
});

test("derives the combined ZIP file name from uploaded CJ OMS Excel", () => {
  assert.equal(getCombinedFbaLabelZipFileName("cj_oms_upload_test.xlsx"), "cj_oms_upload_test.zip");
  assert.equal(getCombinedFbaLabelZipFileName("cj_oms_upload_test.xls"), "cj_oms_upload_test.zip");
  assert.equal(getCombinedFbaLabelZipFileName(null), "FBCL.zip");
});

test("builds one flat ZIP from multiple PDF parse results", async () => {
  const zipBlob = await buildCombinedFbaLabelZip([
    fakeResult("slot-1", ["FBA19DZ63LQ0U000001", "FBA19DZ63LQ0U000002"]),
    fakeResult("slot-2", ["FBA19DZ41HYBU000001"]),
  ]);
  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

  assert.equal(zipBlob instanceof Blob, true);
  assert.deepEqual(Object.keys(zip.files), [
    "FBA19DZ63LQ0U000001.pdf",
    "FBA19DZ63LQ0U000002.pdf",
    "FBA19DZ41HYBU000001.pdf",
  ]);
});
