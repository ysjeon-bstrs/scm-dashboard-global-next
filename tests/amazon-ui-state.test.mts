import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/app/global/amazon/AmazonStockClient.tsx", "utf-8");

test("Amazon center changes are not reset to AMZUS by the data-load effect", () => {
  assert.match(
    source,
    /const loadSummary = useCallback\(async \(nextCenter: AmazonDohCenterFilter\) =>/,
    "loadSummary should take an explicit center instead of defaulting from state",
  );
  assert.doesNotMatch(
    source,
    /const loadSummary = useCallback\(async \(nextCenter = center\)/,
    "loadSummary must not depend on center state; otherwise center changes recreate it",
  );
  assert.match(
    source,
    /}, \[user\]\);/,
    "loadSummary should only depend on user so the initial-load effect does not rerun on center changes",
  );
  assert.match(
    source,
    /void loadSummary\("AMZUS"\);/,
    "the AMZUS default should be used only for the initial authenticated load",
  );
  assert.match(
    source,
    /setStockFilter\("all"\);/,
    "center changes should reset the inventory filter so the newly selected center is visible",
  );
});

test("Inventory detail shows SKU with Korean product name and searches both", () => {
  assert.match(source, />SKU \/ 상품<\//, "Inventory detail header should show SKU / 상품");
  assert.match(
    source,
    /stockNameBySku\.set\(row\.resource_code, row\.resource_name\)/,
    "Inventory rows should reuse DOH product names by SKU",
  );
  assert.match(
    source,
    /row\.resource_name \|\| "-"/,
    "Inventory detail should render the Korean product name below SKU",
  );
  assert.match(
    source,
    /!resourceName\.toLowerCase\(\)\.includes\(needle\)/,
    "Inventory search should match product names as well as SKU",
  );
});
