"use client";

import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  SCM_DASHBOARD_CJ_ALLOCATION_API_PATH,
  SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH,
} from "@/lib/scm-dashboard/constants";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import { summarizeCjStock } from "@/lib/scm-dashboard/cjSummary";
import type {
  CjAllocationRequestRow,
  CjAllocationResponse,
  CjLotAllocationRow,
  CjLotStockResponse,
  CjLotStockRow,
  CjStockSummaryRow,
} from "@/lib/scm-dashboard/cjTypes";
import type { UserSummary } from "@/lib/scm-dashboard/types";
import {
  Banner,
  BrandMark,
  Collapsible,
  GridFrame,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
  type Tone,
} from "@/components/scm-dashboard/ui";

const STATUS_TONE: Record<CjLotAllocationRow["status"], Tone> = {
  allocated: "ok",
  partial: "warn",
  shortage: "danger",
  unmatched: "neutral",
};

function StatusCellRenderer({
  value,
}: {
  value?: CjLotAllocationRow["status"];
}) {
  if (!value) return null;
  return <StatusPill tone={STATUS_TONE[value]}>{value}</StatusPill>;
}

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

// Fuzzy header matching — CJ/order files vary in column naming, so resolve by
// pattern (priority order) instead of exact key match.
const SKU_PATTERNS = [
  /^resource_code$/i,
  /품목\s*코드/,
  /상품\s*코드/,
  /^sku$/i,
  /product[_\s]?code/i,
  /^prod[_\s]?cd$/i,
  /품번/,
  /자재\s*코드/,
];
const QTY_PATTERNS = [
  /요청\s*수량/,
  /출고\s*수량/,
  /주문\s*수량/,
  /requested?[_\s]?qty/i,
  /quantity/i,
  /^qty$/i,
  /수량/,
  /^ea$/i,
];
const NAME_PATTERNS = [/품목$/, /상품\s*명/, /품목\s*명/, /product\s*name/i, /^name$/i, /prodnm/i];
const REF_PATTERNS = [/참조/, /reference/i, /주문\s*번호/, /오더/, /shipment/i, /^order/i, /fba/i];

function resolveColumn(columns: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const hit = columns.find((column) => pattern.test(column.trim()));
    if (hit) return hit;
  }
  return null;
}

interface ParsedWorkbook {
  columns: string[];
  raw: Record<string, unknown>[];
  rows: CjAllocationRequestRow[];
  mapping: { sku: string | null; qty: string | null };
}

async function parseRequestWorkbook(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });

  const columns = raw.length > 0 ? Object.keys(raw[0]) : [];
  const skuCol = resolveColumn(columns, SKU_PATTERNS);
  const qtyCol = resolveColumn(columns, QTY_PATTERNS);
  const nameCol = resolveColumn(columns, NAME_PATTERNS);
  const refCol = resolveColumn(columns, REF_PATTERNS);

  const cell = (record: Record<string, unknown>, col: string | null) =>
    col ? String(record[col] ?? "").trim() : "";

  const rows = raw
    .map((record, index) => ({
      rowNumber: index + 2,
      resource_code: cell(record, skuCol),
      resource_name: cell(record, nameCol),
      requested_qty: Number(cell(record, qtyCol).replace(/,/g, "")) || 0,
      // Outbound warehouse comes from the UI selection, not the file — the
      // file's 배송센터 is the Amazon destination FC, not a CJ depot.
      depot_code: "",
      reference: cell(record, refCol),
    }))
    .filter((row) => row.resource_code && row.requested_qty > 0);

  return { columns, raw, rows, mapping: { sku: skuCol, qty: qtyCol } };
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

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return `${fallback}: ${payload.error}`;
    }
  } catch {
    // Fall through to the generic status message.
  }

  return `${fallback}: ${response.status}`;
}

interface CjAllocationClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

// CJ storage is billed per pallet (a partial pallet still counts as one).
const PALLET_MONTHLY_USD = 25;

const OUTBOUND_TYPES = ["FBA", "TikTokShop", "B2B"] as const;
const DEPOT_OPTIONS = [
  "CJLA 1 Amazon",
  "CJLA 2 TikTokShop",
  "CJLA 4 B2B",
  "Thailand 1 Center",
] as const;

type OutboundType = (typeof OUTBOUND_TYPES)[number];

export default function CjAllocationClient({
  user,
  initialAuthError,
}: CjAllocationClientProps) {
  const [sku, setSku] = useState("");
  const [outboundType, setOutboundType] = useState<OutboundType>("FBA");
  const [depot, setDepot] = useState<string>("CJLA 1 Amazon");
  const [stockRows, setStockRows] = useState<CjLotStockRow[]>([]);
  const [requestRows, setRequestRows] = useState<CjAllocationRequestRow[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
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
      {
        field: "resource_code",
        headerName: "SKU",
        minWidth: 120,
        cellClass: "cell-code",
      },
      { field: "resource_name", headerName: "Name", minWidth: 220, flex: 1 },
      { field: "lot_no", headerName: "Lot", minWidth: 120, cellClass: "cell-code" },
      { field: "expiration_date", headerName: "Expiry", minWidth: 120 },
      {
        field: "available_qty",
        headerName: "가용수량",
        headerTooltip: "CJ 가용수량 (EA)",
        minWidth: 130,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
    ],
    [],
  );

  const allocationColumnDefs = useMemo<ColDef<CjLotAllocationRow>[]>(
    () => [
      { field: "rowNumber", headerName: "Row", minWidth: 90 },
      { field: "reference", headerName: "Reference", minWidth: 140 },
      {
        field: "resource_code",
        headerName: "SKU",
        minWidth: 120,
        cellClass: "cell-code",
      },
      { field: "depot_code", headerName: "Depot", minWidth: 130 },
      { field: "lot_no", headerName: "Lot", minWidth: 120, cellClass: "cell-code" },
      { field: "expiration_date", headerName: "Expiry", minWidth: 120 },
      {
        field: "requested_qty",
        headerName: "Request",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
      },
      {
        field: "allocated_qty",
        headerName: "Allocated",
        minWidth: 120,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
      {
        field: "shortage_qty",
        headerName: "Shortage",
        minWidth: 120,
        type: "numericColumn",
        cellClass: "cell-num",
        cellClassRules: {
          "cell-shortage": (params) => Number(params.value) > 0,
        },
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 130,
        cellClass: "pill-cell",
        cellRenderer: StatusCellRenderer,
      },
    ],
    [],
  );

  const summary = useMemo(() => summarizeCjStock(stockRows), [stockRows]);

  const summaryColumnDefs = useMemo<ColDef<CjStockSummaryRow>[]>(
    () => [
      {
        field: "resource_code",
        headerName: "품번",
        minWidth: 120,
        cellClass: "cell-code",
      },
      { field: "resource_name", headerName: "상품명", minWidth: 240, flex: 1 },
      { field: "expiration_date", headerName: "유통기한", minWidth: 120 },
      {
        field: "available_qty",
        headerName: "가용재고",
        headerTooltip: "전 센터 합산 가용재고 (EA)",
        minWidth: 120,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
      {
        field: "lot_count",
        headerName: "로트수",
        minWidth: 90,
        type: "numericColumn",
        cellClass: "cell-num",
      },
      {
        field: "units_per_box",
        headerName: "입수량",
        headerTooltip: "박스당 입수 수량 (마스터)",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
        cellClassRules: {
          "cell-shortage": (params) => params.value == null,
        },
        valueFormatter: (params) =>
          params.value == null ? "미등록" : Number(params.value).toLocaleString(),
      },
      {
        field: "full_boxes",
        headerName: "가능박스",
        headerTooltip: "⌊가용재고 / 입수량⌋",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
        valueFormatter: (params) =>
          params.value == null ? "—" : Number(params.value).toLocaleString(),
      },
      {
        field: "loose_units",
        headerName: "잔여(낱개)",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
      },
      {
        field: "est_pallets",
        headerName: "예상 팔렛",
        headerTooltip: "가용재고 / 파렛트당 EA (추정)",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
        valueFormatter: (params) =>
          params.value == null ? "—" : Number(params.value).toFixed(1),
      },
    ],
    [],
  );

  const previewColumnDefs = useMemo<ColDef<Record<string, unknown>>[]>(
    () =>
      previewColumns.map((column) => ({
        field: column,
        headerName: column,
        minWidth: 110,
        flex: 1,
      })),
    [previewColumns],
  );

  const loadStock = useCallback(async () => {
    if (!user) return;

    setIsLoadingStock(true);
    setError(null);
    const params = new URLSearchParams({ limit: "500", latestOnly: "true" });
    if (sku.trim()) params.set("sku", sku.trim());

    const response = await fetch(
      `${SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH}?${params.toString()}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      setError(await getApiErrorMessage(response, "CJ lot stock API failed"));
      setIsLoadingStock(false);
      return;
    }

    const payload = (await response.json()) as CjLotStockResponse;
    setStockRows(payload.rows);
    setMessage(`${payload.rows.length.toLocaleString()}개 로트 로드 완료 (전 센터).`);
    setIsLoadingStock(false);
  }, [sku, user]);

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
    const { columns, raw, rows, mapping } = await parseRequestWorkbook(file);
    setPreviewRows(raw);
    setPreviewColumns(columns);
    setRequestRows(rows);
    setAllocationRows([]);

    if (raw.length === 0) {
      setMessage("파일에서 행을 읽지 못했습니다.");
    } else if (rows.length === 0) {
      setError(
        `파일 ${raw.length.toLocaleString()}행을 읽었지만 SKU/수량 컬럼을 자동 인식하지 못했습니다. 감지된 컬럼: ${columns.join(", ")}`,
      );
      setMessage(null);
    } else {
      setMessage(
        `파일 ${raw.length.toLocaleString()}행 · 유효 요청 ${rows.length.toLocaleString()}행 (SKU="${mapping.sku}", 수량="${mapping.qty}").`,
      );
    }
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
      setError(await getApiErrorMessage(response, "CJ allocation API failed"));
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
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected pilot</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            CJ Lot Allocation
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {initialAuthError === "forbidden-domain"
              ? "boosters.kr Google account is required."
              : "Sign in with your boosters.kr Google account."}
          </p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button
            className="btn btn-primary mt-6"
            onClick={signInWithGoogle}
            type="button"
          >
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  const shortageEa = allocationRows.reduce(
    (sum, row) => sum + row.shortage_qty,
    0,
  );

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6 lg:px-8">
      <div className="stagger mx-auto flex w-full max-w-7xl flex-col gap-5">
        <PageHeader
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                Dashboard
              </Link>
              <span className="max-w-[14rem] truncate px-1 text-sm text-muted">
                {user.email}
              </span>
              <button className="btn btn-secondary" onClick={signOut} type="button">
                Sign out
              </button>
            </>
          }
          description="회사 MySQL의 cj_stock(가용재고)을 상품 마스터(입수량)와 합쳐 SKU·유통기한별로 요약하고, 업로드한 요청 수량을 FEFO로 로트 배정합니다. DB에는 쓰지 않습니다."
          eyebrow="CJ pilot"
          title="CJ Lot Allocation"
        />

        {message ? <Banner tone="brand">{message}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="field-label">Stock SKU search</span>
              <input
                className="field mt-1.5 font-mono"
                onChange={(event) => setSku(event.currentTarget.value)}
                placeholder="BA00021"
                value={sku}
              />
            </label>
            <button
              className="btn btn-primary sm:w-32"
              disabled={isLoadingStock}
              onClick={loadStock}
              type="button"
            >
              {isLoadingStock ? "Loading…" : "Load"}
            </button>
          </div>
        </Panel>

        <Panel>
          <div className="grid gap-6 lg:grid-cols-[1.3fr_3fr] lg:gap-9">
            <div className="lg:border-r lg:border-line lg:pr-9">
              <p className="eyebrow">CJ 가용재고</p>
              <p className="mt-3 text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums text-ink">
                {summary.kpis.totalAvailable.toLocaleString()}
              </p>
              <p className="mt-2 text-xs text-faint">전 센터 합계 (EA)</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              <Stat
                hint={`≈ $${(summary.kpis.billedPallets * PALLET_MONTHLY_USD).toLocaleString()}/월 · 팔렛당 $${PALLET_MONTHLY_USD}${
                  summary.kpis.palletUnknownGroups > 0
                    ? ` · 미산정 ${summary.kpis.palletUnknownGroups}건`
                    : ""
                }`}
                label="예상 보관 팔렛"
                tone="brand"
                value={summary.kpis.billedPallets.toLocaleString()}
              />
              <Stat label="품목수" value={summary.kpis.skuCount.toLocaleString()} />
              <Stat label="로트수" value={summary.kpis.lotCount.toLocaleString()} />
              <Stat label="센터수" value={summary.kpis.depotCount.toLocaleString()} />
            </div>
          </div>
        </Panel>

        {summary.unregisteredSkus.length > 0 ? (
          <Banner tone="warn">
            입수량 미등록 {summary.unregisteredSkus.length}개 SKU — 박스 환산 불가:{" "}
            {summary.unregisteredSkus.slice(0, 8).join(", ")}
            {summary.unregisteredSkus.length > 8 ? " 외" : ""}
          </Banner>
        ) : null}

        <Panel>
          <PanelHeader
            eyebrow="Summary"
            meta={`${summary.rows.length.toLocaleString()} groups`}
            title="SKU · 유통기한 요약"
          />
          <p className="-mt-2 mb-3 text-sm text-muted">
            SKU+유통기한으로 묶어 가용재고를 박스·팔렛으로 환산합니다. 각 행은 전
            센터 합산이라 팔렛 수는 추정치입니다.
          </p>
          <GridFrame height={440}>
            <AgGridReact<CjStockSummaryRow>
              autoSizeStrategy={{ type: "fitGridWidth" }}
              columnDefs={summaryColumnDefs}
              defaultColDef={{
                filter: true,
                floatingFilter: true,
                resizable: true,
                sortable: true,
              }}
              rowData={summary.rows}
            />
          </GridFrame>
        </Panel>

        <Collapsible
          meta={`${stockRows.length.toLocaleString()} lots`}
          title="로트별 재고 현황 (전체)"
        >
          <div className="ag-theme-quartz w-full" style={{ height: 420 }}>
            <AgGridReact<CjLotStockRow>
              autoSizeStrategy={{ type: "fitGridWidth" }}
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
        </Collapsible>

        <Panel>
          <PanelHeader eyebrow="Outbound" title="CJ outbound allocation" />
          <p className="-mt-2 mb-5 max-w-2xl text-sm leading-6 text-muted">
            Pick the outbound type and warehouse, then upload the request file.
            Files are parsed in memory only — nothing is written back.
          </p>

          <div className="flex flex-col gap-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="step-no">1</span>
                <h3 className="text-sm font-semibold text-ink">Outbound type</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {OUTBOUND_TYPES.map((type) => (
                  <button
                    aria-pressed={outboundType === type}
                    className={`seg ${outboundType === type ? "seg-on" : "seg-off"}`}
                    key={type}
                    onClick={() => setOutboundType(type)}
                    type="button"
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="step-no">2</span>
                <h3 className="text-sm font-semibold text-ink">
                  Outbound warehouse
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {DEPOT_OPTIONS.map((option) => (
                  <button
                    aria-pressed={depot === option}
                    className={`seg ${depot === option ? "seg-on" : "seg-off"}`}
                    key={option}
                    onClick={() => setDepot(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="step-no">3</span>
                <h3 className="text-sm font-semibold text-ink">
                  Upload request file
                </h3>
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line bg-sunken/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  accept=".xlsx,.xls"
                  className="max-w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand-softer"
                  onChange={(event) =>
                    void handleFile(event.currentTarget.files?.[0] ?? null)
                  }
                  type="file"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={requestRows.length === 0 || isAllocating}
                    onClick={allocate}
                    type="button"
                  >
                    {isAllocating ? "Allocating…" : "Allocate"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={allocationRows.length === 0}
                    onClick={() => downloadAllocationWorkbook(allocationRows)}
                    type="button"
                  >
                    Export
                  </button>
                </div>
              </div>
            </div>

            {previewRows.length > 0 ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="step-no">✓</span>
                  <h3 className="text-sm font-semibold text-ink">업로드 미리보기</h3>
                  <span className="text-xs text-faint">
                    {previewRows.length.toLocaleString()}행 · 유효 요청{" "}
                    {requestRows.length.toLocaleString()}행
                  </span>
                </div>
                <div
                  className="ag-theme-quartz w-full overflow-hidden rounded-xl border border-line"
                  style={{ height: 300 }}
                >
                  <AgGridReact<Record<string, unknown>>
                    autoSizeStrategy={{ type: "fitGridWidth" }}
                    columnDefs={previewColumnDefs}
                    defaultColDef={{
                      filter: true,
                      resizable: true,
                      sortable: true,
                    }}
                    rowData={previewRows}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-3">
            <Stat label="Request rows" value={requestRows.length.toLocaleString()} />
            <Stat
              label="Allocation rows"
              value={allocationRows.length.toLocaleString()}
            />
            <Stat
              label="Shortage EA"
              tone={shortageEa > 0 ? "danger" : "ok"}
              value={shortageEa.toLocaleString()}
            />
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-faint">
            Current selection
            <StatusPill tone="brand">{outboundType}</StatusPill>
            <StatusPill tone="neutral">{depot}</StatusPill>
          </p>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Result"
            meta={`${allocationRows.length.toLocaleString()} rows`}
            title="Allocation result"
          />
          <GridFrame height={360}>
            <AgGridReact<CjLotAllocationRow>
              autoSizeStrategy={{ type: "fitGridWidth" }}
              columnDefs={allocationColumnDefs}
              defaultColDef={{
                filter: true,
                floatingFilter: true,
                resizable: true,
                sortable: true,
              }}
              rowData={allocationRows}
            />
          </GridFrame>
        </Panel>
      </div>
    </main>
  );
}
