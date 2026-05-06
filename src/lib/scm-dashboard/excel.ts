import * as XLSX from "xlsx";

import type { AllocationResultRow, AllocationUploadRow } from "./types";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function readNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function parseAllocationWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [] as AllocationUploadRow[];
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  return rawRows
    .map((row, index): AllocationUploadRow => {
      const resourceCode =
        readString(row.resource_code) ||
        readString(row.resourceCode) ||
        readString(row.SKU) ||
        readString(row.sku);

      return {
        rowNumber: index + 2,
        resource_code: resourceCode,
        center:
          readString(row.center) ||
          readString(row.to_center) ||
          readString(row.toCenter) ||
          null,
        requested_qty:
          readNumber(row.requested_qty) ||
          readNumber(row.requestedQty) ||
          readNumber(row.qty) ||
          readNumber(row.qty_ea),
      };
    })
    .filter((row) => row.resource_code && row.requested_qty > 0);
}

export function exportAllocationWorkbook(rows: AllocationResultRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      row_number: row.rowNumber,
      center: row.center,
      resource_code: row.resource_code,
      requested_qty: row.requested_qty,
      available_qty: row.available_qty,
      allocated_qty: row.allocated_qty,
      shortage_qty: row.shortage_qty,
      status: row.status,
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "allocation");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
