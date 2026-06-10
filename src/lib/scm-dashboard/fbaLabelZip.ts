import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

export const MAX_FBA_LABEL_FILES = 5;
export const COMBINED_FBA_LABEL_ZIP_FILE_NAME = "FBCL.zip";
export const CJ_OMS_ORDER_ID_COLUMN = "주문번호";
export const FBA_BOX_ID_REGEX = /\bFBA[A-Z0-9]{8,}U\d{6}\b/g;
const FBA_BOX_SEQUENCE_REGEX = /U(\d{6})$/;
const PDF_EXTENSION_REGEX = /\.pdf$/i;

type XlsxModule = typeof import("xlsx");

export type FbaLabelStatus = "ok" | "error";

export interface FbaLabelPageRow {
  page: number;
  boxId: string | null;
  sequence: number | null;
  status: FbaLabelStatus;
  messages: string[];
}

export interface FbaLabelPageFile {
  boxId: string;
  bytes: Uint8Array;
}

export interface FbaLabelParseResult {
  slotId: string;
  fileName: string;
  pageCount: number;
  rows: FbaLabelPageRow[];
  pageFiles: FbaLabelPageFile[];
  errors: string[];
  warnings: string[];
}

export interface FbaLabelSlotState {
  id: string;
  result: FbaLabelParseResult | null;
  isProcessing: boolean;
  dragOver: boolean;
}

export interface FbaOrderComparison {
  matched: string[];
  missingInPdf: string[];
  extraInPdf: string[];
  duplicateOrderIds: string[];
  duplicatePdfBoxIds: string[];
}

interface PdfTextItem {
  str?: string;
}

export function extractFbaBoxIdsFromText(text: string): string[] {
  return Array.from(new Set(text.match(FBA_BOX_ID_REGEX) ?? []));
}

export function getFbaPrefix(boxId: string): string {
  return boxId.replace(FBA_BOX_SEQUENCE_REGEX, "");
}

export function getFbaSequence(boxId: string): number | null {
  const match = boxId.match(FBA_BOX_SEQUENCE_REGEX);
  return match ? Number(match[1]) : null;
}

export function hasSequentialFbaBoxIds(boxIds: string[]): boolean {
  if (boxIds.length === 0) return false;
  const prefixes = new Set(boxIds.map(getFbaPrefix));
  if (prefixes.size !== 1) return false;

  return boxIds.every((boxId, index) => getFbaSequence(boxId) === index + 1);
}

export function extractCjOmsOrderIdsFromRows(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  if (!Object.prototype.hasOwnProperty.call(rows[0], CJ_OMS_ORDER_ID_COLUMN)) {
    throw new Error(`${CJ_OMS_ORDER_ID_COLUMN} 컬럼이 없습니다.`);
  }

  const ids: string[] = [];
  rows.forEach((row, index) => {
    const raw = row[CJ_OMS_ORDER_ID_COLUMN];
    if (raw == null || raw === "") return;
    const orderId = String(raw).trim();
    if (!FBA_BOX_ID_REGEX.test(orderId)) {
      FBA_BOX_ID_REGEX.lastIndex = 0;
      throw new Error(`${index + 2}행 주문번호 형식이 올바르지 않습니다: ${orderId}`);
    }
    FBA_BOX_ID_REGEX.lastIndex = 0;
    if (orderId.includes(".pdf")) {
      throw new Error(`${index + 2}행 주문번호에 .pdf가 포함되어 있습니다: ${orderId}`);
    }
    ids.push(orderId);
  });

  return ids;
}

export async function readCjOmsOrderIdsFromWorkbook(file: File): Promise<string[]> {
  const xlsx: XlsxModule = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  return extractCjOmsOrderIdsFromRows(rows);
}

function collectDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates);
}

export function compareCjOmsOrderIdsWithPdfBoxIds(
  orderIds: string[],
  pdfBoxIds: string[],
): FbaOrderComparison {
  const orderSet = new Set(orderIds);
  const pdfSet = new Set(pdfBoxIds);

  return {
    matched: orderIds.filter((orderId) => pdfSet.has(orderId)),
    missingInPdf: orderIds.filter((orderId) => !pdfSet.has(orderId)),
    extraInPdf: pdfBoxIds.filter((boxId) => !orderSet.has(boxId)),
    duplicateOrderIds: collectDuplicates(orderIds),
    duplicatePdfBoxIds: collectDuplicates(pdfBoxIds),
  };
}

export function findCrossPdfDuplicateBoxIds(
  results: FbaLabelParseResult[],
): Set<string> {
  return new Set(collectDuplicates(results.flatMap((result) => result.rows
    .map((row) => row.boxId)
    .filter((boxId): boxId is string => Boolean(boxId)))));
}

export function resultHasBlockingErrors(
  result: FbaLabelParseResult,
  duplicateIds: Set<string> = new Set(),
): boolean {
  if (result.errors.length > 0) return true;
  return result.rows.some((row) => Boolean(row.boxId && duplicateIds.has(row.boxId)));
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION_REGEX.test(file.name);
}

function validateRows(rows: FbaLabelPageRow[]): string[] {
  const errors: string[] = [];
  const boxIds = rows.map((row) => row.boxId).filter((id): id is string => Boolean(id));

  if (boxIds.length !== rows.length) {
    errors.push("Box ID를 찾지 못한 페이지가 있습니다.");
  }

  const duplicates = collectDuplicates(boxIds);
  if (duplicates.length > 0) {
    errors.push(`중복 Box ID가 있습니다: ${duplicates.join(", ")}`);
  }

  if (boxIds.length === rows.length && boxIds.length > 0) {
    const prefixes = new Set(boxIds.map(getFbaPrefix));
    if (prefixes.size > 1) {
      errors.push(`한 PDF 안에 여러 FBA prefix가 감지되었습니다: ${Array.from(prefixes).join(", ")}`);
    } else if (!hasSequentialFbaBoxIds(boxIds)) {
      errors.push("Box ID 연번이 페이지 순서와 일치하지 않습니다.");
    }
  }

  return errors;
}

async function extractPageTexts(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer.slice(0),
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? (item as PdfTextItem).str ?? "" : ""))
      .join(" ");
    pageTexts.push(text);
  }

  await (pdf as typeof pdf & { destroy?: () => Promise<void> }).destroy?.();
  return pageTexts;
}

export async function parseFbaLabelPdf(
  file: File,
  slotId: string,
): Promise<FbaLabelParseResult> {
  const baseResult = {
    slotId,
    fileName: file.name,
    pageCount: 0,
    rows: [] as FbaLabelPageRow[],
    pageFiles: [] as FbaLabelPageFile[],
    errors: [] as string[],
    warnings: [] as string[],
  } satisfies FbaLabelParseResult;

  if (!isPdfFile(file)) {
    return { ...baseResult, errors: ["PDF 파일만 업로드할 수 있습니다."] };
  }

  const arrayBuffer = await file.arrayBuffer();
  const sourcePdf = await PDFDocument.load(arrayBuffer.slice(0));
  const pageCount = sourcePdf.getPageCount();

  if (pageCount === 0) {
    return { ...baseResult, errors: ["PDF 페이지가 없습니다."] };
  }

  const pageTexts = await extractPageTexts(arrayBuffer.slice(0));
  const rows = pageTexts.map((text, index): FbaLabelPageRow => {
    const ids = extractFbaBoxIdsFromText(text);
    const messages: string[] = [];
    let boxId: string | null = null;

    if (ids.length === 0) {
      messages.push("Box ID를 찾지 못했습니다.");
    } else if (ids.length > 1) {
      messages.push(`Box ID가 여러 개 감지되었습니다: ${ids.join(", ")}`);
    } else {
      boxId = ids[0];
    }

    return {
      page: index + 1,
      boxId,
      sequence: boxId ? getFbaSequence(boxId) : null,
      status: messages.length > 0 ? "error" : "ok",
      messages,
    };
  });

  const validationErrors = validateRows(rows);
  if (validationErrors.length > 0) {
    return { ...baseResult, pageCount, rows, errors: validationErrors };
  }

  const pageFiles: FbaLabelPageFile[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.boxId) continue;
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [index]);
    singlePagePdf.addPage(copiedPage);
    const pageBytes = await singlePagePdf.save({ useObjectStreams: true });
    pageFiles.push({ boxId: row.boxId, bytes: pageBytes });
  }

  return { ...baseResult, pageCount, rows, pageFiles };
}

// Backward-compatible alias for earlier implementation/tests.
export const buildFbaLabelZip = parseFbaLabelPdf;

export async function buildCombinedFbaLabelZip(
  results: FbaLabelParseResult[],
): Promise<Blob> {
  const zip = new JSZip();
  for (const result of results) {
    for (const pageFile of result.pageFiles) {
      zip.file(`${pageFile.boxId}.pdf`, pageFile.bytes);
    }
  }
  return zip.generateAsync({ type: "blob" });
}
