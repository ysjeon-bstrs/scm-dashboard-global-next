"use client";

import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { ModuleRegistry, type CellStyle, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  SCM_DASHBOARD_CJ_ALLOCATION_API_PATH,
  SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH,
} from "@/lib/scm-dashboard/constants";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  CjAllocationRequestRow,
  CjAllocationResponse,
  CjLotAllocationRow,
  CjLotStockResponse,
  CjLotStockRow,
} from "@/lib/scm-dashboard/cjTypes";
import type { UserSummary } from "@/lib/scm-dashboard/types";

let modulesRegistered = false;

function registerAgGrid() {
  if (!modulesRegistered) {
    ModuleRegistry.registerModules([AllEnterpriseModule]);
    modulesRegistered = true;
  }

  const licenseKey = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY;
  if (licenseKey) {
    LicenseManager.setLicenseKey(licenseKey);
  }
}

function getStringCell(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function getNumberCell(row: Record<string, unknown>, keys: string[]) {
  const value = getStringCell(row, keys).replace(/,/g, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function parseRequestWorkbook(file: File): Promise<CjAllocationRequestRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });

  return records
    .map((record, index) => ({
      rowNumber: index + 2,
      resource_code: getStringCell(record, [
        "resource_code",
        "SKU",
        "sku",
        "prodCd",
        "prod_cd",
        "상품코드",
      ]),
      resource_name: getStringCell(record, [
        "resource_name",
        "name",
        "ProdNm",
        "상품명",
      ]),
      requested_qty: getNumberCell(record, [
        "requested_qty",
        "qty",
        "quantity",
        "출고수량",
        "요청수량",
        "수량",
      ]),
      depot_code: getStringCell(record, ["depot_code", "depotCd", "depot", "센터"]),
      reference: getStringCell(record, [
        "reference",
        "shipment_id",
        "shipment",
        "FBA",
        "참조",
      ]),
    }))
    .filter((row) => row.resource_code && row.requested_qty > 0);
}

function downloadAllocationWorkbook(rows: CjLotAllocationRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      reference: row.reference ?? "",
      resource_code: row.resource_code,
      resource_name: row.resource_name ?? "",
      depot_code: row.depot_code ?? "",
      requested_qty: row.requested_qty,
      lot_no: row.lot_no ?? "",
      expiration_date: row.expiration_date ?? "",
      available_qty: row.available_qty,
      allocated_qty: row.allocated_qty,
      shortage_qty: row.shortage_qty,
      status: row.status,
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "cj_allocation");
  XLSX.writeFile(workbook, "cj-allocation-result.xlsx");
}

interface CjAllocationClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

export default function CjAllocationClient({
  user,
  initialAuthError,
}: CjAllocationClientProps) {
  const [sku, setSku] = useState("");
  const [depot, setDepot] = useState("");
  const [stockRows, setStockRows] = useState<CjLotStockRow[]>([]);
  const [requestRows, setRequestRows] = useState<CjAllocationRequestRow[]>([]);
  const [allocationRows, setAllocationRows] = useState<CjLotAllocationRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);

  useMemo(() => registerAgGrid(), []);

  const stockColumnDefs = useMemo<ColDef<CjLotStockRow>[]>(
    () => [
      { field: "close_date", headerName: "Close date", minWidth: 120 },
      { field: "depot_code", headerName: "Depot", minWidth: 130 },
      { field: "resource_code", headerName: "SKU", minWidth: 120 },
      { field: "resource_name", headerName: "Name", minWidth: 220, flex: 1 },
      { field: "lot_no", headerName: "Lot", minWidth: 120 },
      { field: "expiration_date", headerName: "Expiry", minWidth: 120 },
      {
        field: "available_qty",
        headerName: "Available",
        minWidth: 120,
        type: "numericColumn",
        cellStyle: { textAlign: "right", fontWeight: 600 } as CellStyle,
      },
      {
        field: "stock_qty",
        headerName: "Stock",
        minWidth: 110,
        type: "numericColumn",
        cellStyle: { textAlign: "right" } as CellStyle,
      },
    ],
    [],
  );

  const allocationColumnDefs = useMemo<ColDef<CjLotAllocationRow>[]>(
    () => [
      { field: "rowNumber", headerName: "Row", minWidth: 90 },
      { field: "reference", headerName: "Reference", minWidth: 140 },
      { field: "resource_code", headerName: "SKU", minWidth: 120 },
      { field: "depot_code", headerName: "Depot", minWidth: 130 },
      { field: "lot_no", headerName: "Lot", minWidth: 120 },
      { field: "expiration_date", headerName: "Expiry", minWidth: 120 },
      {
        field: "requested_qty",
        headerName: "Request",
        minWidth: 110,
        type: "numericColumn",
        cellStyle: { textAlign: "right" } as CellStyle,
      },
      {
        field: "allocated_qty",
        headerName: "Allocated",
        minWidth: 120,
        type: "numericColumn",
        cellStyle: { textAlign: "right", fontWeight: 600 } as CellStyle,
      },
      {
        field: "shortage_qty",
        headerName: "Shortage",
        minWidth: 120,
        type: "numericColumn",
        cellStyle: { textAlign: "right" } as CellStyle,
      },
      { field: "status", headerName: "Status", minWidth: 120 },
    ],
    [],
  );

  const loadStock = useCallback(async () => {
    if (!user) return;

    setIsLoadingStock(true);
    setError(null);
    const params = new URLSearchParams({ limit: "300", latestOnly: "true" });
    if (sku.trim()) params.set("sku", sku.trim());
    if (depot.trim()) params.set("depot", depot.trim());

    const response = await fetch(
      `${SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH}?${params.toString()}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      setError(`CJ lot stock API failed with ${response.status}.`);
      setIsLoadingStock(false);
      return;
    }

    const payload = (await response.json()) as CjLotStockResponse;
    setStockRows(payload.rows);
    setMessage(`Loaded ${payload.rows.length.toLocaleString()} CJ lot rows.`);
    setIsLoadingStock(false);
  }, [depot, sku, user]);

  useEffect(() => {
    // CJ stock rows are synchronized with protected API state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStock();
  }, [loadStock]);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/scm-dashboard/cj-allocation`,
        },
      });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    }
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.reload();
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    const rows = await parseRequestWorkbook(file);
    setRequestRows(rows);
    setAllocationRows([]);
    setMessage(`Parsed ${rows.length.toLocaleString()} valid request rows.`);
  }

  async function allocate() {
    setIsAllocating(true);
    setError(null);
    const response = await fetch(SCM_DASHBOARD_CJ_ALLOCATION_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: requestRows,
        depot: depot.trim() || null,
        latestOnly: true,
      }),
    });

    if (!response.ok) {
      setError(`CJ allocation API failed with ${response.status}.`);
      setIsAllocating(false);
      return;
    }

    const payload = (await response.json()) as CjAllocationResponse;
    setAllocationRows(payload.rows);
    setMessage(payload.notices.join(" "));
    setIsAllocating(false);
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-emerald-700">Protected pilot</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            CJ Lot Allocation
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {initialAuthError === "forbidden-domain"
              ? "boosters.kr Google account is required."
              : "Sign in with your boosters.kr Google account."}
          </p>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button
            className="mt-6 min-h-9 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            onClick={signInWithGoogle}
            type="button"
          >
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-3 py-4 sm:px-5 sm:py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">CJ pilot</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              CJ Lot Allocation
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              회사 MySQL의 cj_stock을 읽고, 업로드한 요청 수량을 FEFO 기준으로
              로트 배정합니다. DB에는 쓰지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            <Link
              className="min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              href="/global/scm-dashboard"
            >
              Dashboard
            </Link>
            <span className="max-w-full truncate px-2 text-sm text-slate-600">
              {user.email}
            </span>
            <button
              className="min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={signOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>

        {message ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_120px]">
            <label className="text-sm font-medium text-slate-700">
              SKU
              <input
                className="mt-1 min-h-9 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) => setSku(event.currentTarget.value)}
                placeholder="BA00021"
                value={sku}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Depot
              <input
                className="mt-1 min-h-9 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) => setDepot(event.currentTarget.value)}
                placeholder="CJLA 1 Amazon"
                value={depot}
              />
            </label>
            <button
              className="mt-auto min-h-9 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isLoadingStock}
              onClick={loadStock}
              type="button"
            >
              {isLoadingStock ? "Loading" : "Load"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">
              Latest CJ lot stock
            </h2>
            <p className="text-xs text-slate-500">{stockRows.length} rows</p>
          </div>
          <div className="ag-theme-quartz w-full" style={{ height: 420 }}>
            <AgGridReact<CjLotStockRow>
              columnDefs={stockColumnDefs}
              defaultColDef={{
                filter: true,
                floatingFilter: true,
                resizable: true,
                sortable: true,
              }}
              rowData={stockRows}
              rowSelection={{ mode: "multiRow" }}
            />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Request upload and allocation
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Accepts columns such as SKU/resource_code, qty/requested_qty, depot,
                reference. Files are parsed in memory only.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                accept=".xlsx,.xls"
                className="min-h-9 max-w-full text-sm"
                onChange={(event) =>
                  void handleFile(event.currentTarget.files?.[0] ?? null)
                }
                type="file"
              />
              <button
                className="min-h-9 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={requestRows.length === 0 || isAllocating}
                onClick={allocate}
                type="button"
              >
                {isAllocating ? "Allocating" : "Allocate"}
              </button>
              <button
                className="min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                disabled={allocationRows.length === 0}
                onClick={() => downloadAllocationWorkbook(allocationRows)}
                type="button"
              >
                Export
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs font-medium uppercase text-slate-500">
                Request rows
              </p>
              <p className="mt-1 text-2xl font-semibold">{requestRows.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs font-medium uppercase text-slate-500">
                Allocation rows
              </p>
              <p className="mt-1 text-2xl font-semibold">{allocationRows.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs font-medium uppercase text-slate-500">
                Shortage EA
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {allocationRows
                  .reduce((sum, row) => sum + row.shortage_qty, 0)
                  .toLocaleString()}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">
              Allocation result
            </h2>
            <p className="text-xs text-slate-500">{allocationRows.length} rows</p>
          </div>
          <div className="ag-theme-quartz w-full" style={{ height: 360 }}>
            <AgGridReact<CjLotAllocationRow>
              columnDefs={allocationColumnDefs}
              defaultColDef={{
                filter: true,
                floatingFilter: true,
                resizable: true,
                sortable: true,
              }}
              rowData={allocationRows}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
