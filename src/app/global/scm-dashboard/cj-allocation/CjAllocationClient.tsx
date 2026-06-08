"use client";

import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH } from "@/lib/scm-dashboard/constants";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import { dedupeCjStockRows, summarizeCjStock } from "@/lib/scm-dashboard/cjSummary";
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
import {
  allocateOrder,
  buildCjWmsRows,
  checkSufficiency,
  type AllocationResult,
  type LotAllocation,
} from "@/lib/scm-dashboard/cjAllocate";
import type {
  CjLotStockResponse,
  CjLotStockRow,
  CjStockSummaryRow,
} from "@/lib/scm-dashboard/cjTypes";
import type { UserSummary } from "@/lib/scm-dashboard/types";
import {
  Banner,
  Collapsible,
  GridFrame,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
} from "@/components/scm-dashboard/ui";

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

const STATUS_LABEL: Record<ValidationStatus, string> = {
  ok: "정상",
  warning: "경고",
  error: "오류",
};

const STATUS_TONE: Record<ValidationStatus, "ok" | "warn" | "danger"> = {
  ok: "ok",
  warning: "warn",
  error: "danger",
};

interface LotResidualRow {
  resource_code: string;
  expiration_date: string | null;
  lot_no: string;
  available_qty: number;
  allocated_qty: number;
  residual_qty: number;
}

function downloadCjWmsWorkbook(
  allocations: LotAllocation[],
  rows: FbaShipmentRow[],
) {
  const wmsRows = buildCjWmsRows(allocations, rows);
  const worksheet = XLSX.utils.json_to_sheet(wmsRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "CJOM주문양식");
  const d = new Date();
  const ts =
    `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}` +
    `${String(d.getMinutes()).padStart(2, "0")}`;
  XLSX.writeFile(workbook, `cj_oms_upload_${ts}.xlsx`);
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

const OUTBOUND_TYPES = ["FBA", "FBT"] as const;
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
  const [dragOver, setDragOver] = useState(false);
  const [manualLots, setManualLots] = useState(false);
  const [selectedLotSet, setSelectedLotSet] = useState<Set<string>>(new Set());
  const [allocResult, setAllocResult] = useState<AllocationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  registerAgGrid();

  const stockColumnDefs = useMemo<ColDef<CjLotStockRow>[]>(
    () => [
      { field: "depot_code", headerName: "가상센터", minWidth: 130 },
      {
        field: "resource_code",
        headerName: "품번",
        minWidth: 110,
        cellClass: "cell-code",
      },
      { field: "resource_name", headerName: "상품명", minWidth: 240, flex: 1 },
      {
        field: "lot_no",
        headerName: "로트번호",
        minWidth: 110,
        cellClass: "cell-code",
      },
      { field: "expiration_date", headerName: "유통기한", minWidth: 110 },
      {
        field: "available_qty",
        headerName: "가용수량",
        headerTooltip: "CJ 가용수량 (EA)",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
      {
        field: "units_per_box",
        headerName: "입수량",
        headerTooltip: "박스당 입수 (마스터)",
        minWidth: 90,
        type: "numericColumn",
        cellClass: "cell-num",
        valueFormatter: (params) =>
          params.value == null ? "미등록" : Number(params.value).toLocaleString(),
      },
      {
        headerName: "박스",
        headerTooltip: "⌊가용수량 / 입수량⌋",
        minWidth: 90,
        type: "numericColumn",
        cellClass: "cell-num",
        valueGetter: (params) => {
          const u = params.data?.units_per_box;
          const a = params.data?.available_qty ?? 0;
          return u && u > 0 ? Math.floor(a / u) : 0;
        },
      },
      {
        headerName: "잔여",
        headerTooltip: "가용수량 mod 입수량 (낱개)",
        minWidth: 90,
        type: "numericColumn",
        cellClass: "cell-num",
        valueGetter: (params) => {
          const u = params.data?.units_per_box;
          const a = params.data?.available_qty ?? 0;
          return u && u > 0 ? a % u : a;
        },
      },
      {
        headerName: "비고",
        minWidth: 130,
        valueGetter: (params) => {
          const u = params.data?.units_per_box;
          const a = params.data?.available_qty ?? 0;
          const loose = u && u > 0 ? a % u : a;
          return loose > 0 ? "잔여/혼입 가능" : "";
        },
      },
    ],
    [],
  );

  const allocationColumnDefs = useMemo<ColDef<LotAllocation>[]>(
    () => [
      { field: "shipment_id", headerName: "Shipment ID", minWidth: 130, cellClass: "cell-code" },
      { field: "fc", headerName: "센터", minWidth: 80 },
      { field: "sku", headerName: "품번", minWidth: 100, cellClass: "cell-code" },
      { field: "expiry_display", headerName: "유통기한", minWidth: 110 },
      { field: "lot", headerName: "로트번호", minWidth: 110, cellClass: "cell-code" },
      {
        headerName: "박스범위",
        minWidth: 110,
        valueGetter: (params) =>
          params.data
            ? params.data.box_start === params.data.box_end
              ? `${params.data.box_start}`
              : `${params.data.box_start}–${params.data.box_end}`
            : "",
      },
      {
        field: "allocated_boxes",
        headerName: "박스수",
        minWidth: 80,
        type: "numericColumn",
        cellClass: "cell-num",
      },
      {
        field: "allocated_qty",
        headerName: "배정수량(EA)",
        minWidth: 120,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
      {
        headerName: "혼입",
        minWidth: 80,
        cellClass: "pill-cell",
        valueGetter: (params) => (params.data?.is_mixed ? "혼입" : ""),
        cellRenderer: (params: { value?: string }) =>
          params.value ? (
            <StatusPill tone="warn">{params.value}</StatusPill>
          ) : null,
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

  // Snapshot meta — latest-only load, so every row shares the same close date.
  const snapshot = useMemo(() => {
    const first = stockRows[0];
    return {
      closeDate: first?.close_date?.slice(0, 10) ?? "",
      updatedAt: first?.updated_at?.replace("T", " ").slice(0, 16) ?? "",
    };
  }, [stockRows]);

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

  const warehouseStock = useMemo(
    () => stockRows.filter((row) => row.depot_code === depot),
    [stockRows, depot],
  );

  const validation = useMemo(() => {
    const rows = parseFbaRows(uploadRows, stockLookup, outboundType);
    validateShipmentRows(rows, stockLookup, stockRows.length > 0);

    // Cumulative sufficiency: if a SKU+expiry group's total demand exceeds the
    // warehouse stock, mark every row in that group as an error so the 정상/오류
    // counts stay consistent with the shortage banner.
    const shortages =
      stockRows.length > 0 ? checkSufficiency(rows, warehouseStock) : [];
    if (shortages.length > 0) {
      const shortKeys = new Set(
        shortages.map((s) => `${s.sku}|${normalizeExpiry(s.expiry)}`),
      );
      for (const row of rows) {
        if (shortKeys.has(`${row.sku}|${row.expiry_norm}`)) {
          row.validation_messages.push(
            "[E] 재고부족 — 유통기한 합계가 가용재고를 초과",
          );
          row.validation_status = "error";
        }
      }
    }

    return { ...summarizeValidation(rows), shortages };
  }, [uploadRows, stockLookup, stockRows.length, warehouseStock, outboundType]);

  const validRows = useMemo(
    () => validation.rows.filter((row) => row.validation_status !== "error"),
    [validation],
  );

  // Lots eligible for the order (requested SKU+expiry at the warehouse).
  const candidateLots = useMemo(() => {
    const wanted = new Set(validRows.map((r) => `${r.sku}|${r.expiry_norm}`));
    return warehouseStock
      .filter((r) =>
        wanted.has(`${r.resource_code}|${normalizeExpiry(r.expiration_date ?? "")}`),
      )
      .sort(
        (a, b) =>
          a.resource_code.localeCompare(b.resource_code) ||
          (a.expiration_date ?? "").localeCompare(b.expiration_date ?? "") ||
          a.lot_no.localeCompare(b.lot_no),
      );
  }, [validRows, warehouseStock]);

  // Group candidate lots by SKU + expiry, with the demand for that group.
  const lotGroups = useMemo(() => {
    const demand = new Map<string, number>();
    for (const r of validRows) {
      const key = `${r.sku}|${r.expiry_norm}`;
      demand.set(key, (demand.get(key) ?? 0) + r.qty);
    }
    const groups = new Map<
      string,
      { sku: string; expiry: string; lots: CjLotStockRow[]; demand: number }
    >();
    for (const lot of candidateLots) {
      const key = `${lot.resource_code}|${normalizeExpiry(lot.expiration_date ?? "")}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          sku: lot.resource_code,
          expiry: lot.expiration_date ?? "",
          lots: [],
          demand: demand.get(key) ?? 0,
        };
        groups.set(key, group);
      }
      group.lots.push(lot);
    }
    return [...groups.values()];
  }, [validRows, candidateLots]);

  // Per-lot remaining quantity after allocation (가용 − 배정).
  const lotResidual = useMemo<LotResidualRow[]>(() => {
    const allocs = allocResult?.allocations ?? [];
    if (allocs.length === 0) return [];
    const allocByKey = new Map<string, number>();
    for (const a of allocs) {
      const key = `${a.sku}|${normalizeExpiry(a.expiry_display)}|${a.lot}`;
      allocByKey.set(key, (allocByKey.get(key) ?? 0) + a.allocated_qty);
    }
    return candidateLots.map((l) => {
      const key = `${l.resource_code}|${normalizeExpiry(l.expiration_date ?? "")}|${l.lot_no}`;
      const allocated = allocByKey.get(key) ?? 0;
      return {
        resource_code: l.resource_code,
        expiration_date: l.expiration_date,
        lot_no: l.lot_no,
        available_qty: l.available_qty,
        allocated_qty: allocated,
        residual_qty: l.available_qty - allocated,
      };
    });
  }, [allocResult, candidateLots]);

  const residualColumnDefs = useMemo<ColDef<LotResidualRow>[]>(
    () => [
      {
        field: "resource_code",
        headerName: "품번",
        minWidth: 100,
        cellClass: "cell-code",
      },
      { field: "expiration_date", headerName: "유통기한", minWidth: 110 },
      {
        field: "lot_no",
        headerName: "로트번호",
        minWidth: 110,
        cellClass: "cell-code",
      },
      {
        field: "available_qty",
        headerName: "가용수량",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
      },
      {
        field: "allocated_qty",
        headerName: "배정수량",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num cell-allocated",
      },
      {
        field: "residual_qty",
        headerName: "잔여수량",
        headerTooltip: "가용수량 − 배정수량",
        minWidth: 110,
        type: "numericColumn",
        cellClass: "cell-num",
      },
    ],
    [],
  );

  function enableManualLots(on: boolean) {
    setManualLots(on);
    if (on) setSelectedLotSet(new Set(candidateLots.map((l) => l.lot_no)));
  }

  function toggleLot(lotNo: string, checked: boolean) {
    setSelectedLotSet((prev) => {
      const next = new Set(prev);
      if (checked) next.add(lotNo);
      else next.delete(lotNo);
      return next;
    });
  }

  const validationColumnDefs = useMemo<ColDef<FbaShipmentRow>[]>(
    () => [
      {
        headerName: "상태",
        minWidth: 86,
        maxWidth: 100,
        cellClass: "pill-cell",
        valueGetter: (params) =>
          params.data ? params.data.validation_status : "",
        cellRenderer: (params: { value?: ValidationStatus }) =>
          params.value ? (
            <StatusPill tone={STATUS_TONE[params.value]}>
              {STATUS_LABEL[params.value]}
            </StatusPill>
          ) : null,
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
    setStockRows(dedupeCjStockRows(payload.rows));
    const closeDate = payload.rows[0]?.close_date?.slice(0, 10);
    setMessage(
      `${closeDate ? `마감일 ${closeDate} · ` : ""}${payload.rows.length.toLocaleString()}개 로트 로드 완료 (전 센터).`,
    );
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


  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setAllocResult(null);
    setFileName(file.name);

    const raw = await readSheetRows(file);
    setUploadRows(raw);
    setMessage(`파일 ${raw.length.toLocaleString()}행 파싱 완료.`);
  }

  function clearUpload() {
    setUploadRows([]);
    setFileName(null);
    setAllocResult(null);
    setManualLots(false);
    setSelectedLotSet(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Allocate locally: each valid row draws from its requested SKU+expiry lots
  // at the selected warehouse (full boxes by lot, then mixed boxes).
  function allocate() {
    setIsAllocating(true);
    setError(null);
    const result = allocateOrder(
      validRows,
      warehouseStock,
      manualLots ? selectedLotSet : null,
    );
    setAllocResult(result);
    setMessage(
      `배정 완료 — ${result.allocations.length.toLocaleString()}개 로트 배정` +
        (result.shortageEa > 0
          ? `, 부족 ${result.shortageEa.toLocaleString()} EA`
          : ""),
    );
    setIsAllocating(false);
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="panel w-full max-w-lg p-6 sm:p-8">
          <p className="eyebrow">글로벌 SCM</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
            CJ 로트 배정 접근
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {initialAuthError === "forbidden-domain"
              ? "boosters.kr Google 계정으로만 접근할 수 있습니다."
              : "boosters.kr Google 계정으로 로그인하세요."}
          </p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button
            className="btn btn-primary mt-6"
            onClick={signInWithGoogle}
            type="button"
          >
            Google로 로그인
          </button>
        </section>
      </main>
    );
  }

  const allocations = allocResult?.allocations ?? [];
  const shortageEa = allocResult?.shortageEa ?? 0;
  const canAllocate =
    validRows.length > 0 && validation.errorCount === 0 && !isAllocating;
  const canDownload = allocations.length > 0 && shortageEa === 0;
  const downloadBlocker = !fileName
    ? "출고 요청 파일을 업로드해야 합니다."
    : validation.errorCount > 0
      ? `검증 오류 ${validation.errorCount.toLocaleString()}건을 먼저 수정해야 합니다.`
      : validRows.length === 0
        ? "다운로드할 유효 요청 행이 없습니다."
        : allocations.length === 0
          ? "로트 배정을 먼저 실행해야 합니다."
          : shortageEa > 0
            ? `부족 ${shortageEa.toLocaleString()} EA가 있어 전량 배정 후 다운로드할 수 있습니다.`
            : "CJ WMS 다운로드 가능";
  const readinessSteps = [
    {
      label: "재고",
      value: stockRows.length > 0 ? `${stockRows.length.toLocaleString()}개 로트` : "로드 필요",
      tone: stockRows.length > 0 ? "ok" : "warn",
    },
    {
      label: "파일",
      value: fileName ? `${validation.rows.length.toLocaleString()}행` : "업로드 대기",
      tone: fileName ? "ok" : "neutral",
    },
    {
      label: "검증",
      value: validation.rows.length
        ? `오류 ${validation.errorCount.toLocaleString()}건`
        : "미실행",
      tone: validation.errorCount > 0 ? "danger" : validation.rows.length ? "ok" : "neutral",
    },
    {
      label: "배정",
      value: allocations.length
        ? `${allocations.length.toLocaleString()}개 로트`
        : "미실행",
      tone: shortageEa > 0 ? "danger" : allocations.length ? "ok" : "neutral",
    },
    {
      label: "WMS",
      value: canDownload ? "다운로드 가능" : "대기",
      tone: canDownload ? "ok" : validation.errorCount > 0 || shortageEa > 0 ? "danger" : "warn",
    },
  ] as const;

  return (
    <main className="min-h-dvh px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">글로벌 SCM / CJ 출고 배정</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
              CJ 로트 배정
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
              업로드 요청을 검증하고 FEFO 기준으로 로트를 배정한 뒤, 다운로드 가능 여부를 바로 확인합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusPill tone="brand">{outboundType}</StatusPill>
            <StatusPill tone="brand">{depot}</StatusPill>
          </div>
        </header>

        {snapshot.closeDate ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            <span>
              마감일 <span className="font-medium text-muted">{snapshot.closeDate}</span>
            </span>
            {snapshot.updatedAt ? (
              <span>
                DB 갱신 <span className="font-medium text-muted">{snapshot.updatedAt}</span>
              </span>
            ) : null}
          </p>
        ) : null}

        {message ? <Banner tone="brand">{message}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel className="p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              hint={centerFilter === "전체" ? "전 센터 합계 EA" : `${centerFilter} 합계 EA`}
              label="가용재고"
              value={summary.kpis.totalAvailable.toLocaleString()}
            />
            <Stat label="센터수" value={summary.kpis.depotCount.toLocaleString()} />
            <Stat label="품목수" value={summary.kpis.skuCount.toLocaleString()} />
            <Stat label="로트수" value={summary.kpis.lotCount.toLocaleString()} />
            <Stat
              hint={`≈ $${(summary.kpis.billedPallets * PALLET_MONTHLY_USD).toLocaleString()}/월${
                summary.kpis.palletUnknownGroups > 0
                  ? ` · 미산정 ${summary.kpis.palletUnknownGroups}건`
                  : ""
              }`}
              label="예상 보관 팔렛"
              tone="brand"
              value={summary.kpis.billedPallets.toLocaleString()}
            />
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
          <PanelHeader eyebrow="출고 배정" title="CJ WMS 다운로드 준비" />
          <p className="-mt-2 mb-4 max-w-2xl text-sm leading-6 text-muted">
            출고 유형과 창고를 선택하고 요청 파일을 업로드하세요. 파일은 브라우저 메모리에서만 검증됩니다.
          </p>

          <div className={`mb-5 rounded-xl border px-4 py-3 ${
            canDownload
              ? "border-ok/30 bg-ok-soft text-ok-ink"
              : validation.errorCount > 0 || shortageEa > 0
                ? "border-danger/30 bg-danger-soft text-danger-ink"
                : "border-warn/30 bg-warn-soft text-warn-ink"
          }`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {canDownload ? "CJ WMS 다운로드 가능" : `다운로드 대기: ${downloadBlocker}`}
                </p>
                <p className="mt-1 text-xs opacity-85">
                  재고, 파일, 검증, 배정 상태를 모두 통과해야 WMS 양식을 받을 수 있습니다.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-5 lg:min-w-[560px]">
                {readinessSteps.map((step) => (
                  <div
                    className="rounded-lg bg-surface/80 px-3 py-2 text-ink ring-1 ring-line"
                    key={step.label}
                  >
                    <p className="field-label">{step.label}</p>
                    <div className="mt-1">
                      <StatusPill tone={step.tone}>{step.value}</StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="step-no">1</span>
                <h3 className="text-sm font-semibold text-ink">출고 유형</h3>
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
                  출고 창고
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

              <div
                aria-label="출고 요청 파일 업로드 (클릭 또는 드래그)"
                className={`cursor-pointer rounded-xl border-2 border-dashed p-3 transition ${
                  dragOver
                    ? "border-brand bg-brand-soft/50"
                    : "border-line bg-sunken/60 hover:border-line-strong"
                }`}
                onClick={(event) => {
                  // Ignore the click bubbling up from the hidden input itself,
                  // otherwise input.click() re-triggers this handler infinitely.
                  if (event.target !== fileInputRef.current) {
                    fileInputRef.current?.click();
                  }
                }}
                onDragLeave={() => setDragOver(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  void handleFile(event.dataTransfer.files?.[0] ?? null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
              >
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
                        onClick={(event) => {
                          event.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        type="button"
                      >
                        다른 파일
                      </button>
                      <button
                        aria-label="업로드 파일 제거"
                        className="btn btn-ghost text-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearUpload();
                        }}
                        type="button"
                      >
                        ✕ 제거
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pointer-events-none flex flex-col items-center gap-1 py-5 text-center">
                    <span className="text-sm font-medium text-ink">
                      출고 요청 엑셀을 드래그하거나 클릭해서 선택
                    </span>
                    <span className="text-xs text-faint">XLSX · XLS</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-faint">
                  업로드하면 자동 검증됩니다. 오류 0건이어야 배정할 수 있어요.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={!canAllocate}
                    onClick={allocate}
                    type="button"
                  >
                    {isAllocating ? "배정 중…" : "로트 배정 실행"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={!canDownload}
                    onClick={() => downloadCjWmsWorkbook(allocations, validRows)}
                    title={!canDownload ? downloadBlocker : undefined}
                    type="button"
                  >
                    CJ WMS 다운로드
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
                  <Stat label="정상" value={validation.okCount.toLocaleString()} />
                  <Stat
                    label="경고"
                    tone={validation.warningCount > 0 ? "warn" : "neutral"}
                    value={validation.warningCount.toLocaleString()}
                  />
                  <Stat
                    label="오류"
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
                      오류가 있는 행이 {validation.errorCount}건 있습니다. 엑셀
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
                      경고 {validation.warningCount}건
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

                {validation.shortages.length > 0 ? (
                  <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                    <p className="font-semibold">
                      재고 부족: {depot} 기준 요청 수량이 가용재고를 초과합니다.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {validation.shortages.map((s) => (
                        <li key={`${s.sku}-${s.expiry}`}>
                          {s.sku} / {s.expiry} — 요청 {s.demand.toLocaleString()} / 가용{" "}
                          {s.available.toLocaleString()} (부족{" "}
                          {s.shortage.toLocaleString()} EA)
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {validRows.length > 0 && validation.errorCount === 0 ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="step-no">4</span>
                  <h3 className="text-sm font-semibold text-ink">로트 선택</h3>
                  <label className="ml-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                    <input
                      checked={manualLots}
                      className="h-4 w-4 accent-brand"
                      onChange={(event) =>
                        enableManualLots(event.currentTarget.checked)
                      }
                      type="checkbox"
                    />
                    수동 선택
                  </label>
                </div>
                {manualLots ? (
                  <div className="space-y-3">
                    <p className="text-xs text-faint">
                      기본은 모든 로트를 자동(로트번호 순)으로 씁니다. 쓰고 싶지 않은
                      로트만 체크를 해제하세요. 유통기한별 <b>선택 합</b>이 <b>요청</b>을
                      채워야 부족이 안 납니다.
                    </p>
                    {lotGroups.map((group) => {
                      const groupKey = `${group.sku}|${group.expiry}`;
                      const selected = group.lots.filter((l) =>
                        selectedLotSet.has(l.lot_no),
                      );
                      const selectedQty = selected.reduce(
                        (s, l) => s + (l.available_qty || 0),
                        0,
                      );
                      const availQty = group.lots.reduce(
                        (s, l) => s + (l.available_qty || 0),
                        0,
                      );
                      const covers = selectedQty >= group.demand;
                      return (
                        <div
                          className="overflow-hidden rounded-xl border border-line"
                          key={groupKey}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/60 px-3 py-2 text-xs">
                            <span className="font-semibold text-ink">
                              <span className="font-mono">{group.sku}</span> ·{" "}
                              {group.expiry}
                            </span>
                            <span
                              className={
                                covers ? "text-muted" : "font-medium text-danger"
                              }
                            >
                              요청 {group.demand.toLocaleString()} / 선택{" "}
                              {selectedQty.toLocaleString()} / 가용{" "}
                              {availQty.toLocaleString()}
                              {!covers
                                ? ` · 부족 ${(group.demand - selectedQty).toLocaleString()}`
                                : ""}
                            </span>
                          </div>
                          <div className="divide-y divide-line">
                            {group.lots.map((l) => {
                              const upb = l.units_per_box ?? 0;
                              const boxes =
                                upb > 0
                                  ? Math.floor((l.available_qty || 0) / upb)
                                  : 0;
                              return (
                                <label
                                  className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-sunken/40"
                                  key={l.lot_no}
                                >
                                  <input
                                    checked={selectedLotSet.has(l.lot_no)}
                                    className="h-4 w-4 accent-brand"
                                    onChange={(event) =>
                                      toggleLot(l.lot_no, event.currentTarget.checked)
                                    }
                                    type="checkbox"
                                  />
                                  <span className="w-28 font-mono">{l.lot_no}</span>
                                  <span className="flex-1 text-right tabular-nums">
                                    {l.available_qty.toLocaleString()} EA
                                  </span>
                                  <span className="w-24 text-right tabular-nums text-faint">
                                    {boxes.toLocaleString()}박스
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-faint">
                    자동 배정: 요청 유통기한의 모든 로트를 로트번호 순으로 사용합니다.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-3">
            <Stat label="유효 요청 행" value={validRows.length.toLocaleString()} />
            <Stat label="배정 로트" value={allocations.length.toLocaleString()} />
            <Stat
              label="부족 EA"
              tone={shortageEa > 0 ? "danger" : "ok"}
              value={shortageEa.toLocaleString()}
            />
          </div>

        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="배정 결과"
            meta={`${allocations.length.toLocaleString()} lots`}
            title="로트 배정 결과"
          />
          <p className="-mt-2 mb-3 text-sm text-muted">
            요청 유통기한 로트에서 박스 단위로 배정하고, 박스에 못 채운 잔여는 같은
            유통기한 로트끼리 혼입 박스로 묶습니다. CJ WMS 다운로드로 업로드 양식을
            받습니다.
          </p>
          {shortageEa > 0 ? (
            <div className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">
              부족 {shortageEa.toLocaleString()} EA: 전량 배정되지 않아 CJ WMS
              다운로드가 막혀 있습니다. 박스 단위로 떨어지지 않는 잔여를 확인하세요.
            </div>
          ) : null}
          <GridFrame height={360}>
            <AgGridReact<LotAllocation>
              autoSizeStrategy={{ type: "fitGridWidth" }}
              columnDefs={allocationColumnDefs}
              defaultColDef={{
                filter: true,
                floatingFilter: true,
                resizable: true,
                sortable: true,
              }}
              rowData={allocations}
            />
          </GridFrame>

          {lotResidual.length > 0 ? (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">
                배정 후 로트 잔여
              </h3>
              <div
                className="ag-theme-quartz w-full overflow-hidden rounded-xl border border-line"
                style={{ height: 240 }}
              >
                <AgGridReact<LotResidualRow>
                  autoSizeStrategy={{ type: "fitGridWidth" }}
                  columnDefs={residualColumnDefs}
                  defaultColDef={{ resizable: true, sortable: true }}
                  rowData={lotResidual}
                />
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </main>
  );
}
