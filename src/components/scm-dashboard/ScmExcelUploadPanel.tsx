"use client";

import { useState } from "react";

import { SCM_DASHBOARD_ALLOCATION_API_PATH } from "@/lib/scm-dashboard/constants";
import { exportAllocationWorkbook } from "@/lib/scm-dashboard/excel";
import type { AllocationResponse, AllocationResultRow } from "@/lib/scm-dashboard/types";

function downloadWorkbook(rows: AllocationResultRow[]) {
  const workbook = exportAllocationWorkbook(rows);
  const blob = new Blob([workbook], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scm-allocation-result.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export function ScmExcelUploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<AllocationResultRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function submitFile() {
    if (!file) return;

    setIsUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(SCM_DASHBOARD_ALLOCATION_API_PATH, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      setMessage(`Upload failed: ${response.status}`);
      setIsUploading(false);
      return;
    }

    const payload = (await response.json()) as AllocationResponse;
    setRows(payload.rows);
    setMessage(payload.notices.join(" ") || `${payload.rows.length} rows processed.`);
    setIsUploading(false);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Excel allocation</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload rows with SKU, center, and requested quantity. Files are parsed in memory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept=".xlsx,.xls"
            className="min-h-9 max-w-full text-sm"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
            type="file"
          />
          <button
            className="min-h-9 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!file || isUploading}
            onClick={submitFile}
            type="button"
          >
            {isUploading ? "Processing" : "Calculate"}
          </button>
          <button
            className="min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
            disabled={rows.length === 0}
            onClick={() => downloadWorkbook(rows)}
            type="button"
          >
            Export
          </button>
        </div>
      </div>
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}
