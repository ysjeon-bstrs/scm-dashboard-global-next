/**
 * CJ FBA outbound upload validation — faithful port of the Python dashboard's
 * cj_outbound.py 판정 step (scm_dashboard_v9/ui/cj_outbound.py).
 *
 * Codes: A=박스수, B=수량(EA=박스수×입수량), C=BoxID 중복, D=BoxID 연속성(경고),
 *        E=재고/유통기한, F=Reference Number, G=수취인 정보.
 */

export type ValidationStatus = "ok" | "warning" | "error";

export interface FbaShipmentRow {
  rowNumber: number;
  reference_number: string;
  shipment_id: string;
  fc: string;
  address: string;
  alt_address: string;
  ship_method: string;
  sku: string;
  product_name: string;
  box_id_range: string;
  qty: number;
  expiry_display: string; // "YYYY-MM-DD" for display
  expiry_norm: string; // "YYYYMMDD" for matching
  box_start: number;
  box_end: number;
  box_count: number; // end - start + 1
  box_unit: number; // 입수량 (master, or qty/declared for FBT)
  declared_box_count: number;
  box_prefix: string; // for FBT order_no
  box_num_width: number; // for FBT order_no zero-padding
  fulfillment_type: FulfillmentType;
  validation_status: ValidationStatus;
  validation_messages: string[];
}

export type FulfillmentType = "FBA" | "FBT";

/** Stock + master lookups, scoped to the selected outbound warehouse. */
export interface CjStockLookup {
  /** 입수량 (master units per box), 0 if unregistered. */
  boxUnitOf(sku: string): number;
  /** Whether the SKU has any stock at the warehouse. */
  skuExists(sku: string): boolean;
  /** Normalized (YYYYMMDD) available expiries for the SKU at the warehouse. */
  expiriesOf(sku: string): string[];
}

// Header → field map (keys are lower-cased + trimmed).
const COLUMN_MAP: Record<string, string> = {
  "reference number": "reference_number",
  "reference_number": "reference_number",
  referencenumber: "reference_number",
  ref: "reference_number",
  "fba shipment id": "shipment_id",
  fba_shipment_id: "shipment_id",
  "shipment id": "shipment_id",
  shipment_id: "shipment_id",
  shipmentid: "shipment_id",
  배송센터: "fc",
  fc: "fc",
  센터: "fc",
  배송지주소: "address",
  address: "address",
  주소: "address",
  대체주소: "alt_address",
  alt_address: "alt_address",
  출고방법: "ship_method",
  ship_method: "ship_method",
  품번: "sku",
  sku: "sku",
  품목: "product_name",
  product_name: "product_name",
  상품명: "product_name",
  박스id: "box_id_range",
  box_id: "box_id_range",
  boxid: "box_id_range",
  "box id": "box_id_range",
  박스수량: "declared_box_count",
  box_count: "declared_box_count",
  "carton count": "declared_box_count",
  수량: "qty",
  qty: "qty",
  quantity: "qty",
  유통기한: "expiry_date",
  expiry_date: "expiry_date",
  expiry: "expiry_date",
};

const INVALID_VALUES = new Set(["", "nan", "none", "null"]);

interface BoxIdMeta {
  start: number;
  end: number;
  prefix: string;
  width: number;
}

function parseBoxIdMeta(boxId: string): BoxIdMeta {
  if (!boxId) return { start: 0, end: 0, prefix: "", width: 0 };
  const text = String(boxId).trim();
  const range = /^([A-Za-z]*)(\d+)\s*[-~]\s*([A-Za-z]*)(\d+)$/.exec(text);
  if (range) {
    const startPrefix = range[1].toUpperCase();
    const endPrefix = range[3].toUpperCase();
    if (startPrefix && endPrefix && startPrefix !== endPrefix) {
      return { start: 0, end: 0, prefix: "", width: 0 };
    }
    return {
      start: Number(range[2]),
      end: Number(range[4]),
      prefix: startPrefix || endPrefix,
      width: Math.max(range[2].length, range[4].length),
    };
  }
  const single = /^([A-Za-z]*)(\d+)$/.exec(text);
  if (single) {
    const n = Number(single[2]);
    return { start: n, end: n, prefix: single[1].toUpperCase(), width: single[2].length };
  }
  return { start: 0, end: 0, prefix: "", width: 0 };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Excel serial date → "YYYY-MM-DD" (epoch 1899-12-30). */
function excelSerialToDisplay(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toExpiryDisplay(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  if (typeof value === "number") return excelSerialToDisplay(value);
  return String(value).trim().split(" ")[0];
}

export function normalizeExpiry(value: string): string {
  if (!value) return "";
  return value.replace(/[-/.]/g, "").trim().slice(0, 8);
}

function str(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  if (v == null) return "";
  return String(v).trim();
}

function num(record: Record<string, unknown>, key: string): number {
  const v = record[key];
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Map a raw sheet row (original headers) to mapped field keys. */
function mapColumns(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = COLUMN_MAP[String(k).trim().toLowerCase()];
    if (field && out[field] === undefined) out[field] = v;
  }
  return out;
}

export function parseFbaRows(
  rawRows: Record<string, unknown>[],
  lookup: CjStockLookup,
  fulfillmentType: FulfillmentType = "FBA",
): FbaShipmentRow[] {
  const rows: FbaShipmentRow[] = [];
  rawRows.forEach((rawRow, index) => {
    const r = mapColumns(rawRow);
    // Some Amazon/CJ order templates leave `FBA Shipment ID` blank and carry
    // the operational shipment key only in `Reference Number` (for example
    // MV..._FC rows with C0001-C0104 carton ranges). Treat Reference Number as
    // the shipment grouping key in that case instead of dropping the row.
    const referenceNumber = str(r, "reference_number");
    const shipment = str(r, "shipment_id") || referenceNumber;
    const sku = str(r, "sku");
    if (!shipment || !sku) return; // skip blank rows

    const { start, end, prefix, width } = parseBoxIdMeta(str(r, "box_id_range"));
    const expiryDisplay = toExpiryDisplay(r["expiry_date"]);
    const qty = num(r, "qty");
    const declaredBoxCount = num(r, "declared_box_count");

    // FBT derives 입수량 from qty/박스수량 when it divides cleanly; FBA uses master.
    let boxUnit = lookup.boxUnitOf(sku);
    if (
      fulfillmentType === "FBT" &&
      declaredBoxCount > 0 &&
      qty > 0 &&
      qty % declaredBoxCount === 0
    ) {
      boxUnit = qty / declaredBoxCount;
    }

    rows.push({
      rowNumber: index + 2,
      reference_number: referenceNumber,
      shipment_id: shipment,
      fc: str(r, "fc"),
      address: str(r, "address"),
      alt_address: str(r, "alt_address"),
      ship_method: str(r, "ship_method") || "SPD",
      sku,
      product_name: str(r, "product_name"),
      box_id_range: str(r, "box_id_range"),
      qty,
      expiry_display: expiryDisplay,
      expiry_norm: normalizeExpiry(expiryDisplay),
      box_start: start,
      box_end: end,
      box_count: end >= start ? end - start + 1 : 0,
      box_unit: boxUnit,
      declared_box_count: declaredBoxCount,
      box_prefix: prefix,
      box_num_width: width,
      fulfillment_type: fulfillmentType,
      validation_status: "ok",
      validation_messages: [],
    });
  });
  return rows;
}

function setError(row: FbaShipmentRow, message: string) {
  row.validation_messages.push(message);
  row.validation_status = "error";
}

function setWarning(row: FbaShipmentRow, message: string) {
  row.validation_messages.push(message);
  if (row.validation_status === "ok") row.validation_status = "warning";
}

// A: BoxID parse + declared count
function validateBoxId(row: FbaShipmentRow) {
  if (row.box_start <= 0 || row.box_end <= 0 || row.box_end < row.box_start) {
    setError(row, `[A] BoxID 형식을 해석할 수 없습니다: ${row.box_id_range}`);
    return;
  }
  const expected = row.box_end - row.box_start + 1;
  if (row.declared_box_count > 0 && row.declared_box_count !== expected) {
    setError(row, `[A] 박스수 불일치: ${row.declared_box_count} ≠ ${expected}`);
  }
}

// B: qty == box_count × box_unit
function validateQty(row: FbaShipmentRow) {
  if (row.box_unit > 0) {
    const expected = row.box_count * row.box_unit;
    if (row.qty !== expected) {
      setError(
        row,
        `[B] EA 불일치: ${row.qty} ≠ ${row.box_count}박스 × ${row.box_unit}입수 = ${expected}`,
      );
    }
  } else {
    setError(row, `[B] 입수량 미등록 SKU: ${row.sku}`);
  }
}

// C: BoxID overlap within the same shipment
function validateOverlap(row: FbaShipmentRow, sameShipment: FbaShipmentRow[]) {
  for (const other of sameShipment) {
    if (other === row) continue;
    if (row.box_start <= other.box_end && row.box_end >= other.box_start) {
      setError(
        row,
        `[C] BoxID 구간 겹침: ${row.box_id_range} vs ${other.box_id_range} (${other.sku})`,
      );
      break;
    }
  }
}

// D: BoxID continuity / starts at 1 (first row only) — warning
function validateContinuity(
  row: FbaShipmentRow,
  sameShipment: FbaShipmentRow[],
  isFirst: boolean,
) {
  if (row.fulfillment_type === "FBT") return; // FBT carton ids aren't sequential
  if (!isFirst) return;
  const ids = new Set<number>();
  for (const r of sameShipment) {
    for (let i = r.box_start; i <= r.box_end; i += 1) ids.add(i);
  }
  if (ids.size === 0) return;
  const minBox = Math.min(...ids);
  const maxBox = Math.max(...ids);
  if (minBox !== 1) {
    setWarning(row, `[D] BoxID가 1부터 시작하지 않음 (시작: ${minBox})`);
  }
  const missing: number[] = [];
  for (let i = minBox; i <= maxBox; i += 1) if (!ids.has(i)) missing.push(i);
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(", ");
    setWarning(
      row,
      `[D] BoxID 불연속: 누락된 번호 [${shown}${missing.length > 5 ? ", …" : ""}]`,
    );
  }
}

// E: CJ stock has SKU + exact expiry (at warehouse)
function validateStock(
  row: FbaShipmentRow,
  lookup: CjStockLookup,
  stockLoaded: boolean,
) {
  if (!stockLoaded) return;
  if (!lookup.skuExists(row.sku)) {
    setError(row, `[E] CJ 재고에 ${row.sku} SKU가 없습니다`);
    return;
  }
  const expiries = lookup.expiriesOf(row.sku);
  if (!expiries.includes(row.expiry_norm)) {
    setError(
      row,
      `[E] CJ 재고에 ${row.sku}/${row.expiry_display} 유통기한이 없습니다. 가용 유통기한: ${expiries.join(", ")}`,
    );
  }
}

// F: Reference Number required
function validateReference(row: FbaShipmentRow) {
  if (!row.reference_number.trim()) {
    setError(row, "[F] Reference Number가 비어있습니다. 필수 입력 항목입니다.");
  }
}

// G: recipient (FC + address) required
function validateRecipient(row: FbaShipmentRow) {
  if (INVALID_VALUES.has(row.fc.toLowerCase())) {
    setError(row, "[G] 배송센터(FC)가 비어있습니다");
  }
  if (INVALID_VALUES.has(row.address.toLowerCase())) {
    setError(row, "[G] 배송지주소가 비어있습니다");
  }
}

export function validateShipmentRows(
  rows: FbaShipmentRow[],
  lookup: CjStockLookup,
  stockLoaded: boolean,
): FbaShipmentRow[] {
  const groups = new Map<string, FbaShipmentRow[]>();
  for (const row of rows) {
    const list = groups.get(row.shipment_id) ?? [];
    list.push(row);
    groups.set(row.shipment_id, list);
  }

  for (const row of rows) {
    row.validation_messages = [];
    row.validation_status = "ok";
    const sameShipment = groups.get(row.shipment_id) ?? [];
    const isFirst = sameShipment[0] === row;

    validateBoxId(row);
    validateReference(row);
    validateQty(row);
    validateOverlap(row, sameShipment);
    validateContinuity(row, sameShipment, isFirst);
    validateRecipient(row);
    validateStock(row, lookup, stockLoaded);
  }
  return rows;
}

export function extractErrorCodes(messages: string[]): string {
  const codes: string[] = [];
  for (const msg of messages) {
    const m = /^\[([A-Z])\]/.exec(msg);
    if (m && !codes.includes(m[1])) codes.push(m[1]);
  }
  return codes.join(", ");
}

export function getRemark(row: FbaShipmentRow): string {
  const remarks: string[] = [];
  if (row.alt_address && !INVALID_VALUES.has(row.alt_address.toLowerCase())) {
    remarks.push("대체 주소");
  }
  const codes = extractErrorCodes(row.validation_messages);
  if (codes) remarks.push(`오류: ${codes}`);
  return remarks.join(", ");
}

export interface ValidationSummary {
  rows: FbaShipmentRow[];
  okCount: number;
  warningCount: number;
  errorCount: number;
}

export function summarizeValidation(rows: FbaShipmentRow[]): ValidationSummary {
  let okCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  for (const row of rows) {
    if (row.validation_status === "error") errorCount += 1;
    else if (row.validation_status === "warning") warningCount += 1;
    else okCount += 1;
  }
  return { rows, okCount, warningCount, errorCount };
}
