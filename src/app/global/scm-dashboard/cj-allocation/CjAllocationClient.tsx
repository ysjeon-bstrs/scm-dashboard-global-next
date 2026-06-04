"use client";

import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  SCM_DASHBOARD_CJ_ALLOCATION_API_PATH,
  SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH,
} from "@/lib/scm-dashboard/constants";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import { summarizeCjStock } from "@/lib/scm-dashboard/cjSummary";
import {
  getRemark,
  normalizeExpiry,
  parseFbaRows,
  summarizeValidation,
  validateShipmentRows,
  type CjStockLookup,
  type FbaShipmentRow,
  type ValidationStatus,
} from "@/lib/scm-dashboard/cjValidation";
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

async function readSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });
}

const STATUS_ICON: Record<ValidationStatus, string> = {
  ok: "✅",
  warning: "⚠️",
  error: "❌",
};

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
  const [skuQuery, setSkuQuery] = useState("");
  const [centerFilter, setCenterFilter] = useState("전체");
  const [outboundType, setOutboundType] = useState<OutboundType>("FBA");
  const [depot, setDepot] = useState<string>("CJLA 1 Amazon");
  const [stockRows, setStockRows] = useState<CjLotStockRow[]>([]);
  const [uploadRows, setUploadRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [allocationRows, setAllocationRows] = useState<CjLotAllocationRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Center options derived from the loaded snapshot ("전체" + each depot).
  const centerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of stockRows) if (row.depot_code) set.add(row.depot_code);
    return ["전체", ...Array.from(set).sort()];
  }, [stockRows]);

  // Single source of truth for the stock view: center + SKU/name filter.
  const filteredStock = useMemo(() => {
    const query = skuQuery.trim().toLowerCase();
    return stockRows.filter((row) => {
      if (centerFilter !== "전체" && row.depot_code !== centerFilter) return false;
      if (!query) return true;
      return (
        row.resource_code.toLowerCase().includes(query) ||
        (row.resource_name ?? "").toLowerCase().includes(query)
      );
    });
  }, [stockRows, centerFilter, skuQuery]);

  const summary = useMemo(() => summarizeCjStock(filteredStock), [filteredStock]);

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

  // Stock + master lookup scoped to the selected outbound warehouse.
  const stockLookup = useMemo<CjStockLookup>(() => {
    const boxUnit = new Map<string, number>();
    const expiries = new Map<string, Set<string>>();
    const skusAtDepot = new Set<string>();
    for (const row of stockRows) {
      if (row.units_per_box != null && !boxUnit.has(row.resource_code)) {
        boxUnit.set(row.resource_code, row.units_per_box);
      }
      if (row.depot_code === depot) {
        skusAtDepot.add(row.resource_code);
        const set = expiries.get(row.resource_code) ?? new Set<string>();
        if (row.expiration_date) set.add(normalizeExpiry(row.expiration_date));
        expiries.set(row.resource_code, set);
      }
    }
    return {
      boxUnitOf: (s) => boxUnit.get(s) ?? 0,
      skuExists: (s) => skusAtDepot.has(s),
      expiriesOf: (s) => Array.from(expiries.get(s) ?? []).sort(),
    };
  }, [stockRows, depot]);

  const validation = useMemo(() => {
    const rows = parseFbaRows(uploadRows, stockLookup);
    validateShipmentRows(rows, stockLookup, stockRows.length > 0);
    return summarizeValidation(rows);
  }, [uploadRows, stockLookup, stockRows.length]);

  const validRequestRows = useMemo<CjAllocationRequestRow[]>(
    () =>
      validation.rows
        .filter((row) => row.validation_status !== "error")
        .map((row) => ({
          rowNumber: row.rowNumber,
          resource_code: row.sku,
          resource_name: row.product_name,
          requested_qty: row.qty,
          depot_code: "",
          reference: row.reference_number,
        })),
    [validation],
  );

  const validationColumnDefs = useMemo<ColDef<FbaShipmentRow>[]>(
    () => [
      {
        headerName: "상태",
        minWidth: 70,
        maxWidth: 80,
        valueGetter: (params) =>
          params.data ? STATUS_ICON[params.data.validation_status] : "",
      },
      { field: "reference_number", headerName: "Ref No.", minWidth: 150, cellClass: "cell-code" },
      { field: "shipment_id", headerName: "Shipment ID", minWidth: 130, cellClass: "cell-code" },
      { field: "fc", headerName: "센터", minWidth: 80 },
      { field: "sku", headerName: "품번", minWidth: 100, cellClass: "cell-code" },
      { field: "expiry_display", headerName: "유통기한", minWidth: 110 },
      { field: "box_id_range", headerName: "박스ID", minWidth: 90 },
      { field: "box_count", headerName: "박스수", minWidth: 80, type: "numericColumn", cellClass: "cell-num" },
      { field: "qty", headerName: "수량(EA)", minWidth: 100, type: "numericColumn", cellClass: "cell-num" },
      { field: "box_unit", headerName: "입수량", minWidth: 90, type: "numericColumn", cellClass: "cell-num" },
      {
        headerName: "비고",
        minWidth: 160,
        flex: 1,
        valueGetter: (params) => (params.data ? getRemark(params.data) : ""),
        cellClassRules: {
          "cell-shortage": (params) => params.data?.validation_status === "error",
        },
      },
    ],
    [],
  );

  // Load the full latest snapshot once; center + SKU filtering is client-side.
  const loadStock = useCallback(async () => {
    if (!user) return;

    setIsLoadingStock(true);
    setError(null);

    const response = await fetch(
      `${SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH}?limit=500&latestOnly=true`,
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
  }, [user]);

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
    setAllocationRows([]);
    setFileName(file.name);

    const raw = await readSheetRows(file);
    setUploadRows(raw);
    setMessage(`파일 ${raw.length.toLocaleString()}행 파싱 완료.`);
  }

  function clearUpload() {
    setUploadRows([]);
    setFileName(null);
    setAllocationRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function allocate() {
    setIsAllocating(true);
    setError(null);
    const response = await fetch(SCM_DASHBOARD_CJ_ALLOCATION_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: validRequestRows,
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
          <div className="grid gap-6 lg:grid-cols-[1.3fr_3fr] lg:gap-9">
            <div className="lg:border-r lg:border-line lg:pr-9">
              <p className="eyebrow">CJ 가용재고</p>
              <p className="mt-3 text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums text-ink">
                {summary.kpis.totalAvailable.toLocaleString()}
              </p>
              <p className="mt-2 text-xs text-faint">
                {centerFilter === "전체"
                  ? "전 센터 합계 (EA)"
                  : `${centerFilter} 합계 (EA)`}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              <Stat label="센터수" value={summary.kpis.depotCount.toLocaleString()} />
              <Stat label="품목수" value={summary.kpis.skuCount.toLocaleString()} />
              <Stat label="로트수" value={summary.kpis.lotCount.toLocaleString()} />
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
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0">
              <span className="field-label">가상센터</span>
              <select
                className="field mt-1.5"
                onChange={(event) => setCenterFilter(event.currentTarget.value)}
                value={centerFilter}
              >
                {centerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="field-label">품번 / 상품명 검색</span>
              <input
                className="field mt-1.5"
                onChange={(event) => setSkuQuery(event.currentTarget.value)}
                placeholder="BA00022 또는 비타민"
                value={skuQuery}
              />
            </label>
            <button
              className="btn btn-secondary sm:w-28"
              disabled={isLoadingStock}
              onClick={loadStock}
              type="button"
            >
              {isLoadingStock ? "불러오는 중…" : "새로고침"}
            </button>
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
            SKU+유통기한으로 묶어 가용재고를 박스·팔렛으로 환산합니다. 상단의
            센터·검색 필터가 함께 적용되며, 전 센터 합산 시 팔렛 수는 추정치입니다.
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
          meta={`${filteredStock.length.toLocaleString()} lots`}
          title="로트별 재고 현황"
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
              rowData={filteredStock}
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
                  출고 요청 파일 업로드
                </h3>
              </div>

              <div className="rounded-xl border border-dashed border-line bg-sunken/60 p-3">
                <input
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(event) =>
                    void handleFile(event.currentTarget.files?.[0] ?? null)
                  }
                  ref={fileInputRef}
                  type="file"
                />
                {fileName ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span aria-hidden>📄</span>
                      <span className="truncate font-medium text-ink">
                        {fileName}
                      </span>
                      <span className="shrink-0 text-xs text-faint">
                        · {validation.rows.length.toLocaleString()}행
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="btn btn-ghost"
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                      >
                        다른 파일
                      </button>
                      <button
                        aria-label="업로드 파일 제거"
                        className="btn btn-ghost text-danger"
                        onClick={clearUpload}
                        type="button"
                      >
                        ✕ 제거
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="flex w-full cursor-pointer flex-col items-center gap-1 py-4 text-center"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <span className="text-sm font-medium text-ink">
                      출고 요청 엑셀을 선택하세요
                    </span>
                    <span className="text-xs text-faint">
                      XLSX · XLS — 클릭해서 파일 선택
                    </span>
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-faint">
                  업로드하면 자동 검증됩니다. 오류 0건이어야 배정할 수 있어요.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={
                      validRequestRows.length === 0 ||
                      validation.errorCount > 0 ||
                      isAllocating
                    }
                    onClick={allocate}
                    type="button"
                  >
                    {isAllocating ? "배정 중…" : "로트 배정 실행"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={allocationRows.length === 0}
                    onClick={() => downloadAllocationWorkbook(allocationRows)}
                    type="button"
                  >
                    배정 결과 다운로드
                  </button>
                </div>
              </div>
            </div>

            {validation.rows.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="step-no">✓</span>
                  <h3 className="text-sm font-semibold text-ink">
                    업로드 데이터 검증
                  </h3>
                  <span className="text-xs text-faint">
                    {validation.rows.length.toLocaleString()}행
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-x-6 gap-y-4 rounded-xl border border-line bg-sunken/40 px-4 py-3">
                  <Stat label="✅ 정상" value={validation.okCount.toLocaleString()} />
                  <Stat
                    label="⚠️ 경고"
                    tone={validation.warningCount > 0 ? "warn" : "neutral"}
                    value={validation.warningCount.toLocaleString()}
                  />
                  <Stat
                    label="❌ 오류"
                    tone={validation.errorCount > 0 ? "danger" : "neutral"}
                    value={validation.errorCount.toLocaleString()}
                  />
                </div>

                <div
                  className="ag-theme-quartz w-full overflow-hidden rounded-xl border border-line"
                  style={{ height: 320 }}
                >
                  <AgGridReact<FbaShipmentRow>
                    columnDefs={validationColumnDefs}
                    defaultColDef={{ resizable: true, sortable: true }}
                    rowData={validation.rows}
                  />
                </div>

                {validation.errorCount > 0 ? (
                  <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                    <p className="font-semibold">
                      ❌ 오류가 있는 행이 {validation.errorCount}건 있습니다. 엑셀
                      파일을 수정 후 다시 업로드해주세요.
                    </p>
                    <ul className="mt-2 space-y-2">
                      {validation.rows
                        .filter((row) => row.validation_status === "error")
                        .map((row) => (
                          <li key={row.rowNumber}>
                            <span className="font-medium">
                              {row.shipment_id} / {row.sku} / {row.expiry_display}
                            </span>
                            <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                              {row.validation_messages.map((msg, i) => (
                                <li key={`${row.rowNumber}-${i}`}>{msg}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}

                {validation.warningCount > 0 ? (
                  <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn-ink">
                    <p className="font-semibold">
                      ⚠️ 경고 {validation.warningCount}건
                    </p>
                    <ul className="mt-2 space-y-2">
                      {validation.rows
                        .filter((row) => row.validation_status === "warning")
                        .map((row) => (
                          <li key={row.rowNumber}>
                            <span className="font-medium">
                              {row.shipment_id} / {row.sku} / {row.expiry_display}
                            </span>
                            <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                              {row.validation_messages.map((msg, i) => (
                                <li key={`${row.rowNumber}-${i}`}>{msg}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-3">
            <Stat label="유효 요청 행" value={validRequestRows.length.toLocaleString()} />
            <Stat
              label="배정 행"
              value={allocationRows.length.toLocaleString()}
            />
            <Stat
              label="부족 EA"
              tone={shortageEa > 0 ? "danger" : "ok"}
              value={shortageEa.toLocaleString()}
            />
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-faint">
            현재 선택
            <StatusPill tone="brand">{outboundType}</StatusPill>
            <StatusPill tone="brand">{depot}</StatusPill>
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
