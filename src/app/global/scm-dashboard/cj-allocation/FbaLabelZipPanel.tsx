"use client";

import { useMemo, useRef, useState } from "react";

import { Banner, Panel, PanelHeader, Stat, StatusPill } from "@/components/scm-dashboard/ui";
import {
  buildCombinedFbaLabelZip,
  COMBINED_FBA_LABEL_ZIP_FILE_NAME,
  compareCjOmsOrderIdsWithPdfBoxIds,
  findCrossPdfDuplicateBoxIds,
  MAX_FBA_LABEL_FILES,
  parseFbaLabelPdf,
  readCjOmsOrderIdsFromWorkbook,
  resultHasBlockingErrors,
  type FbaLabelParseResult,
  type FbaLabelSlotState,
} from "@/lib/scm-dashboard/fbaLabelZip";

const INITIAL_SLOT: FbaLabelSlotState = {
  id: "fba-label-1",
  result: null,
  isProcessing: false,
  dragOver: false,
};

function makeSlot(): FbaLabelSlotState {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `fba-label-${id}`,
    result: null,
    isProcessing: false,
    dragOver: false,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getSlotOkCount(result: FbaLabelParseResult | null) {
  return result?.rows.filter((row) => row.status === "ok").length ?? 0;
}

function getSlotErrorCount(result: FbaLabelParseResult | null) {
  return (result?.rows.filter((row) => row.status === "error").length ?? 0) +
    (result?.errors.length ?? 0);
}

export function FbaLabelZipPanel() {
  const [slots, setSlots] = useState<FbaLabelSlotState[]>([INITIAL_SLOT]);
  const [orderFileName, setOrderFileName] = useState<string | null>(null);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [isReadingOrders, setIsReadingOrders] = useState(false);
  const [orderDragOver, setOrderDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isBuildingZip, setIsBuildingZip] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const orderInputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => slots.map((slot) => slot.result).filter((result): result is FbaLabelParseResult => Boolean(result)),
    [slots],
  );
  const duplicateIds = useMemo(() => findCrossPdfDuplicateBoxIds(results), [results]);
  const pdfBoxIds = useMemo(
    () => results.flatMap((result) => result.rows.map((row) => row.boxId).filter((boxId): boxId is string => Boolean(boxId))),
    [results],
  );
  const comparison = useMemo(
    () => compareCjOmsOrderIdsWithPdfBoxIds(orderIds, pdfBoxIds),
    [orderIds, pdfBoxIds],
  );

  const canAddSlot = slots.length < MAX_FBA_LABEL_FILES;
  const hasPdfErrors = results.some((result) => resultHasBlockingErrors(result, duplicateIds));
  const hasComparisonErrors =
    orderIds.length === 0 ||
    results.length === 0 ||
    comparison.missingInPdf.length > 0 ||
    comparison.extraInPdf.length > 0 ||
    comparison.duplicateOrderIds.length > 0 ||
    comparison.duplicatePdfBoxIds.length > 0;
  const canDownloadCombinedZip = !hasPdfErrors && !hasComparisonErrors && !isBuildingZip;

  function updateSlot(slotId: string, patch: Partial<FbaLabelSlotState>) {
    setSlots((current) =>
      current.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)),
    );
  }

  function addSlot() {
    setSlots((current) => {
      if (current.length >= MAX_FBA_LABEL_FILES) return current;
      return [...current, makeSlot()];
    });
  }

  function clearOrRemoveSlot(slotId: string) {
    setPanelError(null);
    setNotice(null);
    setSlots((current) => {
      if (current.length === 1) {
        return [{ ...current[0], result: null, isProcessing: false, dragOver: false }];
      }
      return current.filter((slot) => slot.id !== slotId);
    });
    if (inputRefs.current[slotId]) inputRefs.current[slotId]!.value = "";
    delete inputRefs.current[slotId];
  }

  async function handleOrderFile(file: File | null) {
    if (!file) return;
    setPanelError(null);
    setNotice(null);
    setIsReadingOrders(true);
    try {
      const parsed = await readCjOmsOrderIdsFromWorkbook(file);
      setOrderFileName(file.name);
      setOrderIds(parsed);
      setNotice(`${file.name}: 주문번호 ${parsed.length.toLocaleString()}건 로드 완료`);
    } catch (error) {
      setOrderFileName(null);
      setOrderIds([]);
      setPanelError(error instanceof Error ? error.message : "CJ OMS 엑셀 처리 중 오류가 발생했습니다.");
    } finally {
      setIsReadingOrders(false);
    }
  }

  function clearOrderFile() {
    setOrderFileName(null);
    setOrderIds([]);
    if (orderInputRef.current) orderInputRef.current.value = "";
  }

  async function handlePdfFile(slotId: string, file: File | null) {
    if (!file) return;
    setPanelError(null);
    setNotice(null);
    updateSlot(slotId, { isProcessing: true, result: null, dragOver: false });

    try {
      const result = await parseFbaLabelPdf(file, slotId);
      updateSlot(slotId, { result, isProcessing: false, dragOver: false });
      if (result.errors.length > 0) {
        setPanelError(`${result.fileName}: ${result.errors[0]}`);
      } else {
        setNotice(`${result.fileName}: ${result.pageCount.toLocaleString()}장 추출 완료`);
      }
    } catch (error) {
      updateSlot(slotId, { result: null, isProcessing: false, dragOver: false });
      setPanelError(
        error instanceof Error
          ? error.message
          : "FBA 라벨 PDF 처리 중 오류가 발생했습니다.",
      );
    }
  }

  async function downloadCombinedZip() {
    if (!canDownloadCombinedZip) return;
    setIsBuildingZip(true);
    setPanelError(null);
    try {
      const blob = await buildCombinedFbaLabelZip(results);
      downloadBlob(blob, COMBINED_FBA_LABEL_ZIP_FILE_NAME);
      setNotice(`${COMBINED_FBA_LABEL_ZIP_FILE_NAME}: ${pdfBoxIds.length.toLocaleString()}개 라벨 PDF 생성 완료`);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "통합 ZIP 생성 중 오류가 발생했습니다.");
    } finally {
      setIsBuildingZip(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        eyebrow="보조 도구"
        meta={`${slots.length}/${MAX_FBA_LABEL_FILES} PDFs · ZIP 1개`}
        title="Amazon FBA 라벨 ZIP 생성"
      />
      <p className="-mt-2 mb-4 max-w-3xl text-sm leading-6 text-muted">
        CJ OMS 엑셀 1개와 Amazon 센터별 FBA 라벨 PDF 최대 5개를 함께 업로드하세요.
        PDF를 낱장으로 분리한 뒤, 엑셀의 주문번호와 PDF Box ID가 1:1로 일치할 때만
        폴더 없는 통합 {COMBINED_FBA_LABEL_ZIP_FILE_NAME}을 생성합니다.
      </p>

      {notice ? <div className="mb-3"><Banner tone="ok">{notice}</Banner></div> : null}
      {panelError ? <div className="mb-3"><Banner tone="danger">{panelError}</Banner></div> : null}
      {duplicateIds.size > 0 ? (
        <div className="mb-3">
          <Banner tone="danger">
            PDF 간 중복 Box ID가 있습니다: {Array.from(duplicateIds).slice(0, 6).join(", ")}
            {duplicateIds.size > 6 ? " 외" : ""}
          </Banner>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-line bg-sunken/30 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">1. CJ OMS 엑셀 업로드</p>
            <p className="mt-1 text-xs text-faint">A열 주문번호 컬럼을 기준으로 검증합니다.</p>
          </div>
          {orderFileName ? (
            <button className="btn btn-ghost" onClick={clearOrderFile} type="button">
              초기화
            </button>
          ) : null}
        </div>
        <div
          className={`cursor-pointer rounded-xl border-2 border-dashed p-3 transition ${
            orderDragOver
              ? "border-brand bg-brand-soft/50"
              : "border-line bg-surface hover:border-line-strong"
          }`}
          onClick={(event) => {
            if (event.target !== orderInputRef.current) orderInputRef.current?.click();
          }}
          onDragLeave={() => setOrderDragOver(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setOrderDragOver(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOrderDragOver(false);
            void handleOrderFile(event.dataTransfer.files?.[0] ?? null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              orderInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <input
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => void handleOrderFile(event.currentTarget.files?.[0] ?? null)}
            ref={orderInputRef}
            type="file"
          />
          <div className="pointer-events-none flex flex-col items-center gap-1 py-4 text-center">
            <span className="text-sm font-medium text-ink">
              {isReadingOrders
                ? "엑셀 처리 중…"
                : orderFileName
                  ? orderFileName
                  : "CJ OMS 엑셀을 드래그하거나 클릭해서 선택"}
            </span>
            <span className="text-xs text-faint">필수 · 주문번호 {orderIds.length.toLocaleString()}건</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink">2. Amazon FBA 라벨 PDF 업로드</p>
        {slots.map((slot, index) => {
          const result = slot.result;
          const affectedDuplicates = result?.rows
            .map((row) => row.boxId)
            .filter((boxId): boxId is string => Boolean(boxId && duplicateIds.has(boxId))) ?? [];

          return (
            <div className="rounded-xl border border-line bg-sunken/30 p-3" key={slot.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">라벨 PDF {index + 1}</p>
                  {result ? <p className="mt-1 text-xs text-faint">{result.fileName}</p> : null}
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => clearOrRemoveSlot(slot.id)}
                  type="button"
                >
                  {slots.length === 1 ? "초기화" : "제거"}
                </button>
              </div>

              <div
                aria-label={`FBA 라벨 PDF ${index + 1} 업로드`}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-3 transition ${
                  slot.dragOver
                    ? "border-brand bg-brand-soft/50"
                    : "border-line bg-surface hover:border-line-strong"
                }`}
                onClick={(event) => {
                  if (event.target !== inputRefs.current[slot.id]) {
                    inputRefs.current[slot.id]?.click();
                  }
                }}
                onDragLeave={() => updateSlot(slot.id, { dragOver: false })}
                onDragOver={(event) => {
                  event.preventDefault();
                  updateSlot(slot.id, { dragOver: true });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handlePdfFile(slot.id, event.dataTransfer.files?.[0] ?? null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inputRefs.current[slot.id]?.click();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <input
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(event) => void handlePdfFile(slot.id, event.currentTarget.files?.[0] ?? null)}
                  ref={(node) => {
                    inputRefs.current[slot.id] = node;
                  }}
                  type="file"
                />
                <div className="pointer-events-none flex flex-col items-center gap-1 py-4 text-center">
                  <span className="text-sm font-medium text-ink">
                    {slot.isProcessing
                      ? "PDF 처리 중…"
                      : result
                        ? result.fileName
                        : "FBA 라벨 PDF를 드래그하거나 클릭해서 선택"}
                  </span>
                  <span className="text-xs text-faint">PDF · 페이지별 Box ID 자동 추출</span>
                </div>
              </div>

              {result ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3 sm:grid-cols-4">
                    <Stat label="페이지" value={result.pageCount.toLocaleString()} />
                    <Stat label="추출 성공" tone="ok" value={getSlotOkCount(result).toLocaleString()} />
                    <Stat
                      label="오류"
                      tone={getSlotErrorCount(result) > 0 || affectedDuplicates.length > 0 ? "danger" : "neutral"}
                      value={(getSlotErrorCount(result) + affectedDuplicates.length).toLocaleString()}
                    />
                    <div>
                      <p className="field-label">상태</p>
                      <div className="mt-2">
                        <StatusPill tone={resultHasBlockingErrors(result, duplicateIds) ? "danger" : "ok"}>
                          {resultHasBlockingErrors(result, duplicateIds) ? "확인 필요" : "정상"}
                        </StatusPill>
                      </div>
                    </div>
                  </div>

                  {result.errors.length > 0 ? (
                    <Banner tone="danger">
                      {result.errors.slice(0, 4).join(" / ")}
                      {result.errors.length > 4 ? " 외" : ""}
                    </Banner>
                  ) : null}
                  {affectedDuplicates.length > 0 ? (
                    <Banner tone="danger">
                      다른 PDF와 중복된 Box ID: {affectedDuplicates.slice(0, 6).join(", ")}
                      {affectedDuplicates.length > 6 ? " 외" : ""}
                    </Banner>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border border-line">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-sunken text-faint">
                        <tr>
                          <th className="px-3 py-2 font-medium">페이지</th>
                          <th className="px-3 py-2 font-medium">Box ID</th>
                          <th className="px-3 py-2 font-medium">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-surface text-muted">
                        {result.rows.slice(0, 10).map((row) => (
                          <tr key={row.page}>
                            <td className="px-3 py-2 tabular-nums">{row.page}</td>
                            <td className="px-3 py-2 font-mono text-ink">{row.boxId ?? "-"}</td>
                            <td className="px-3 py-2">
                              {row.status === "ok" ? "정상" : row.messages.join(" / ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.rows.length > 10 ? (
                      <p className="border-t border-line bg-surface px-3 py-2 text-xs text-faint">
                        외 {(result.rows.length - 10).toLocaleString()}장
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-xs text-faint">
          PDF는 최대 5개까지 업로드할 수 있고, 모든 낱장 PDF는 {COMBINED_FBA_LABEL_ZIP_FILE_NAME} 루트에 평면 구조로 들어갑니다.
        </p>
        <button
          className="btn btn-secondary"
          disabled={!canAddSlot}
          onClick={addSlot}
          type="button"
        >
          + PDF 추가
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Stat label="엑셀 주문번호" value={orderIds.length.toLocaleString()} />
          <Stat label="PDF 라벨" value={pdfBoxIds.length.toLocaleString()} />
          <Stat label="매칭" tone="ok" value={comparison.matched.length.toLocaleString()} />
          <Stat
            label="엑셀만 있음"
            tone={comparison.missingInPdf.length > 0 ? "danger" : "neutral"}
            value={comparison.missingInPdf.length.toLocaleString()}
          />
          <Stat
            label="PDF만 있음"
            tone={comparison.extraInPdf.length > 0 ? "danger" : "neutral"}
            value={comparison.extraInPdf.length.toLocaleString()}
          />
        </div>

        {comparison.missingInPdf.length > 0 ? (
          <div className="mt-3"><Banner tone="danger">엑셀에는 있지만 PDF에 없는 주문번호: {comparison.missingInPdf.slice(0, 8).join(", ")}{comparison.missingInPdf.length > 8 ? " 외" : ""}</Banner></div>
        ) : null}
        {comparison.extraInPdf.length > 0 ? (
          <div className="mt-3"><Banner tone="danger">PDF에는 있지만 엑셀에 없는 Box ID: {comparison.extraInPdf.slice(0, 8).join(", ")}{comparison.extraInPdf.length > 8 ? " 외" : ""}</Banner></div>
        ) : null}
        {comparison.duplicateOrderIds.length > 0 ? (
          <div className="mt-3"><Banner tone="danger">엑셀 주문번호 중복: {comparison.duplicateOrderIds.slice(0, 8).join(", ")}{comparison.duplicateOrderIds.length > 8 ? " 외" : ""}</Banner></div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-faint">
            엑셀 주문번호와 PDF Box ID가 완전히 일치해야 다운로드할 수 있습니다.
          </p>
          <button
            className="btn btn-primary"
            disabled={!canDownloadCombinedZip}
            onClick={() => void downloadCombinedZip()}
            title={!canDownloadCombinedZip ? "엑셀과 PDF 라벨 매칭을 먼저 완료해야 합니다." : undefined}
            type="button"
          >
            {isBuildingZip ? "ZIP 생성 중…" : `${COMBINED_FBA_LABEL_ZIP_FILE_NAME} 다운로드`}
          </button>
        </div>
      </div>
    </Panel>
  );
}
