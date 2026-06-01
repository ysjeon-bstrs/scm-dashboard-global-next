"use client";

import { useState } from "react";

import { SCM_DASHBOARD_ALLOCATION_API_PATH } from "@/lib/scm-dashboard/constants";
import { exportAllocationWorkbook } from "@/lib/scm-dashboard/excel";
import type { AllocationResponse, AllocationResultRow } from "@/lib/scm-dashboard/types";
import { Panel, PanelHeader } from "@/components/scm-dashboard/ui";

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
    <Panel>
      <PanelHeader eyebrow="Allocation" title="Excel allocation" />
      <p className="-mt-2 mb-3 text-sm leading-6 text-muted">
        Upload rows with SKU, center, and requested quantity. Files are parsed in
        memory only.
      </p>
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line bg-sunken/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          accept=".xlsx,.xls"
          className="max-w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand-softer"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          type="file"
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={!file || isUploading}
            onClick={submitFile}
            type="button"
          >
            {isUploading ? "Processing…" : "Calculate"}
          </button>
          <button
            className="btn btn-secondary"
            disabled={rows.length === 0}
            onClick={() => downloadWorkbook(rows)}
            type="button"
          >
            Export
          </button>
        </div>
      </div>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </Panel>
  );
}
