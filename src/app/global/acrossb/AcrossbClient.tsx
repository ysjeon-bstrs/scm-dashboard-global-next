"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, BrandMark, PageHeader, Panel, PanelHeader, StatusPill } from "@/components/scm-dashboard/ui";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  AcrossbInboundRequestRow,
  AcrossbInventoryRow,
  AcrossbSkuSummaryRow,
  AcrossbSummary,
  AcrossbWarehouseCode,
} from "@/lib/scm-dashboard/acrossbQueries";
import type { UserSummary } from "@/lib/scm-dashboard/types";

interface AcrossbClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

type ActiveTab = "sku" | "lot" | "inbound";

const emptySummary: AcrossbSummary = {
  meta: {
    generated_at: "",
    warehouse_codes: ["AXB-NL-DKW-1", "AXB-UK-HMI-1"],
    latest_inventory_updated_at: null,
    warehouse_count: 0,
    inventory_row_count: 0,
    sku_count: 0,
    lot_count: 0,
    inbound_request_count: 0,
  },
  totals: {
    on_hand_qty: 0,
    available_qty: 0,
    on_hold_qty: 0,
    inbound_unit_quantity: 0,
  },
  warehouses: [],
  skuRows: [],
  inventoryRows: [],
  inboundRows: [],
};

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  if (value.startsWith("1970-01-01")) return "-";
  return value.slice(0, 10);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  if (value.startsWith("1970-01-01")) return "-";
  return value.replace("T", " ").slice(0, 16);
}

function expiryDays(value: string | null | undefined) {
  if (!value) return null;
  return Math.ceil((new Date(`${value.slice(0, 10)}T00:00:00.000Z`).getTime() - Date.now()) / 86_400_000);
}

function expiryTone(value: string | null | undefined) {
  const days = expiryDays(value);
  if (days === null) return "neutral" as const;
  if (days < 180) return "danger" as const;
  if (days < 365) return "warn" as const;
  return "neutral" as const;
}

function warehouseLabel(code: string) {
  if (code === "AXB-NL-DKW-1") return "NL 1";
  if (code === "AXB-UK-HMI-1") return "UK 1";
  return code;
}

function transportTone(method: string) {
  if (method === "OCEAN") return "brand" as const;
  if (method === "AIR") return "warn" as const;
  return "neutral" as const;
}

function warehouseAccent(code: string) {
  if (code === "AXB-NL-DKW-1") {
    return {
      card: "border-sky-200 bg-sky-50/45",
      pill: "border-sky-200 bg-sky-100 text-sky-800",
      dot: "bg-sky-500",
    };
  }

  if (code === "AXB-UK-HMI-1") {
    return {
      card: "border-violet-200 bg-violet-50/45",
      pill: "border-violet-200 bg-violet-100 text-violet-800",
      dot: "bg-violet-500",
    };
  }

  return {
    card: "border-line bg-white",
    pill: "border-line bg-sunken text-muted",
    dot: "bg-muted",
  };
}

export default function AcrossbClient({ user, initialAuthError }: AcrossbClientProps) {
  const [summary, setSummary] = useState<AcrossbSummary>(emptySummary);
  const [activeTab, setActiveTab] = useState<ActiveTab>("sku");
  const [warehouse, setWarehouse] = useState<"ALL" | AcrossbWarehouseCode>("ALL");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authMessage = useMemo(() => {
    if (!initialAuthError) return null;
    if (initialAuthError === "forbidden-domain") return "boosters.kr Google 계정만 접근할 수 있습니다.";
    if (initialAuthError === "unauthenticated") return "AcrossB 재고 화면을 보려면 boosters.kr Google 계정으로 로그인하세요.";
    return null;
  }, [initialAuthError]);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/acrossb`,
        },
      });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    }
  }

  const loadSummary = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/acrossb/summary", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "AcrossB summary API failed.");
      setSummary(payload as AcrossbSummary);
      setHasLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AcrossB data load failed.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  const queryText = query.trim().toLowerCase();
  const warehouseSkuRows = useMemo(
    () => filterRows(summary.skuRows, warehouse, queryText, (row) => [row.sku, row.name, row.warehouse_code]),
    [summary.skuRows, warehouse, queryText],
  );
  const warehouseInventoryRows = useMemo(
    () => filterRows(summary.inventoryRows, warehouse, queryText, (row) => [row.sku, row.name, row.lot_number, row.reference_number, row.location_code, row.warehouse_code]),
    [summary.inventoryRows, warehouse, queryText],
  );
  const warehouseInboundRows = useMemo(
    () => filterRows(summary.inboundRows, warehouse, queryText, (row) => [row.reference_number, row.status, row.transport_method, row.warehouse_code, row.requested_by]),
    [summary.inboundRows, warehouse, queryText],
  );

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-12 text-ink">
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected AcrossB desk</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">AcrossB 재고</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{authMessage}</p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button className="btn btn-primary mt-6" onClick={signInWithGoogle} type="button">
            Google로 로그인
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-page px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <PageHeader
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                SCM Dashboard
              </Link>
              <button className="btn btn-primary" disabled={isLoading} onClick={() => void loadSummary()} type="button">
                {isLoading ? "새로고침 중" : "새로고침"}
              </button>
            </>
          }
          description="회사 DB의 AcrossB Open API 테이블을 read-only로 조회합니다. US 창고는 제외하고 NL/UK WMS 현재 재고와 입고 요청 이력을 먼저 보여줍니다."
          eyebrow="AcrossB warehouse"
          title="AcrossB NL/UK 재고"
        />

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {isLoading && !hasLoaded ? <Banner>AcrossB 재고 데이터를 불러오는 중…</Banner> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Panel><Metric label="가용재고" value={formatNumber(summary.totals.available_qty)} hint="NL/UK 합계 EA" tone="ok" /></Panel>
          <Panel><Metric label="SKU" value={formatNumber(summary.meta.sku_count)} hint={`${formatNumber(summary.meta.inventory_row_count)} WMS rows`} /></Panel>
          <Panel><Metric label="LOT" value={formatNumber(summary.meta.lot_count)} hint="SKU+LOT+유통기한" /></Panel>
          <Panel><Metric label="입고요청" value={formatNumber(summary.meta.inbound_request_count)} hint={`${formatNumber(summary.totals.inbound_unit_quantity)} EA`} tone="brand" /></Panel>
          <Panel><Metric label="최신 WMS 갱신" value={formatDate(summary.meta.latest_inventory_updated_at)} hint={formatDateTime(summary.meta.latest_inventory_updated_at)} tone="brand" /></Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {summary.warehouses.map((row) => (
            <Panel className={warehouseAccent(row.warehouse_code).card} key={row.warehouse_code}>
              <PanelHeader
                meta={`${row.country_code} · ${row.timezone}`}
                title={
                  <span className="inline-flex items-center gap-2">
                    <WarehousePill code={row.warehouse_code} />
                    <span className="text-xs font-medium text-faint">{row.warehouse_code}</span>
                  </span>
                }
              />
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <SmallStat label="가용" value={formatNumber(row.available_qty)} tone="text-ok-ink" />
                <SmallStat label="SKU" value={formatNumber(row.sku_count)} />
                <SmallStat label="LOT" value={formatNumber(row.lot_count)} />
                <SmallStat label="입고요청" value={formatNumber(row.inbound_request_count)} />
              </div>
              <p className="mt-3 text-xs text-faint">최신 WMS 갱신 {formatDateTime(row.latest_inventory_updated_at)}</p>
            </Panel>
          ))}
        </div>

        <Panel>
          <div className="grid gap-3 lg:grid-cols-[10rem_1fr_auto] lg:items-end">
            <label>
              <span className="field-label">창고</span>
              <select className="field mt-1.5" value={warehouse} onChange={(event) => setWarehouse(event.currentTarget.value as "ALL" | AcrossbWarehouseCode)}>
                <option value="ALL">NL/UK 전체</option>
                <option value="AXB-NL-DKW-1">NL 1</option>
                <option value="AXB-UK-HMI-1">UK 1</option>
              </select>
            </label>
            <label>
              <span className="field-label">검색</span>
              <input className="field mt-1.5" placeholder="SKU, 상품명, LOT, reference 검색" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            </label>
            <button className="btn btn-secondary" disabled={!query && warehouse === "ALL"} onClick={() => { setQuery(""); setWarehouse("ALL"); }} type="button">
              필터 초기화
            </button>
          </div>
        </Panel>

        <div className="flex flex-wrap gap-2">
          <TabButton active={activeTab === "sku"} onClick={() => setActiveTab("sku")}>SKU 요약</TabButton>
          <TabButton active={activeTab === "lot"} onClick={() => setActiveTab("lot")}>LOT/WMS 재고</TabButton>
          <TabButton active={activeTab === "inbound"} onClick={() => setActiveTab("inbound")}>입고 요청</TabButton>
        </div>

        {activeTab === "sku" ? <SkuTable rows={warehouseSkuRows} /> : null}
        {activeTab === "lot" ? <InventoryTable rows={warehouseInventoryRows} /> : null}
        {activeTab === "inbound" ? <InboundTable rows={warehouseInboundRows} /> : null}
      </div>
    </main>
  );
}

function filterRows<T extends { warehouse_code: string }>(
  rows: T[],
  warehouse: "ALL" | AcrossbWarehouseCode,
  queryText: string,
  fields: (row: T) => Array<string | null | undefined>,
) {
  return rows.filter((row) => {
    if (warehouse !== "ALL" && row.warehouse_code !== warehouse) return false;
    if (!queryText) return true;
    return fields(row).some((field) => String(field ?? "").toLowerCase().includes(queryText));
  });
}

function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "ok" | "brand" }) {
  const toneClass = tone === "ok" ? "text-ok-ink" : tone === "brand" ? "text-brand-ink" : "text-ink";
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className={`mt-2 text-[1.65rem] leading-none font-semibold tracking-tight tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

function SmallStat({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-sunken px-3 py-2">
      <p className="text-[11px] font-medium text-faint">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`btn ${active ? "btn-primary" : "btn-secondary"}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function WarehousePill({ code }: { code: string }) {
  const accent = warehouseAccent(code);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${accent.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
      {warehouseLabel(code)}
    </span>
  );
}

function SkuTable({ rows }: { rows: AcrossbSkuSummaryRow[] }) {
  return (
    <Panel className="p-0">
      <div className="border-b border-line px-4 py-3"><PanelHeader title="SKU 요약" meta={`${formatNumber(rows.length)} rows`} /></div>
      <TableFrame>
        <thead><tr>{["창고", "SKU", "상품명", "가용", "보유", "LOT", "최대 보관일"].map((head) => <Th key={head}>{head}</Th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-line" key={`${row.warehouse_code}-${row.sku}`}>
              <Td><WarehousePill code={row.warehouse_code} /></Td>
              <Td mono strong>{row.sku}</Td>
              <Td>{row.name}</Td>
              <Td align="right" strong>{formatNumber(row.available_qty)}</Td>
              <Td align="right">{formatNumber(row.on_hand_qty)}</Td>
              <Td align="right">{formatNumber(row.lot_count)}</Td>
              <Td align="right">{row.max_inventory_age_days ?? "-"}</Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </Panel>
  );
}

function InventoryTable({ rows }: { rows: AcrossbInventoryRow[] }) {
  return (
    <Panel className="p-0">
      <div className="border-b border-line px-4 py-3"><PanelHeader title="LOT / WMS 현재 재고" meta={`${formatNumber(rows.length)} rows`} /></div>
      <TableFrame>
        <thead><tr>{["창고", "SKU", "LOT", "유통기한", "가용", "보유", "입고수량", "입고일", "보관일", "Reference", "Location"].map((head) => <Th key={head}>{head}</Th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-line" key={`${row.warehouse_code}-${row.line_item_id}-${row.sku}-${row.lot_number}`}>
              <Td><WarehousePill code={row.warehouse_code} /></Td>
              <Td mono strong>{row.sku}</Td>
              <Td mono>{row.lot_number || "-"}</Td>
              <Td><StatusPill tone={expiryTone(row.expiration_date)}>{formatDate(row.expiration_date)}</StatusPill></Td>
              <Td align="right" strong>{formatNumber(row.available_qty)}</Td>
              <Td align="right">{formatNumber(row.on_hand_qty)}</Td>
              <Td align="right">{formatNumber(row.received_qty)}</Td>
              <Td>{formatDate(row.received_at)}</Td>
              <Td align="right">{row.inventory_age_days ?? "-"}</Td>
              <Td mono>{row.reference_number}</Td>
              <Td mono>{row.location_code || "-"}</Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </Panel>
  );
}

function InboundTable({ rows }: { rows: AcrossbInboundRequestRow[] }) {
  return (
    <Panel className="p-0">
      <div className="border-b border-line px-4 py-3"><PanelHeader title="입고 요청" meta={`${formatNumber(rows.length)} requests`} /></div>
      <TableFrame>
        <thead><tr>{["창고", "Reference", "상태", "운송", "요청일", "입고예정", "입고완료", "SKU", "Item rows", "Unit", "Carton", "BL/AWB"].map((head) => <Th key={head}>{head}</Th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-line" key={row.inbound_id}>
              <Td><WarehousePill code={row.warehouse_code} /></Td>
              <Td mono strong>{row.reference_number}</Td>
              <Td><StatusPill tone={row.status === "COMPLETED" ? "ok" : "warn"}>{row.status}</StatusPill></Td>
              <Td><StatusPill tone={transportTone(row.transport_method)}>{row.transport_method || "-"}</StatusPill></Td>
              <Td>{formatDate(row.requested_at)}</Td>
              <Td>{formatDate(row.expected_inbound_date)}</Td>
              <Td>{formatDate(row.completed_inbound_date)}</Td>
              <Td align="right">{formatNumber(row.sku_count)}</Td>
              <Td align="right">{formatNumber(row.item_rows)}</Td>
              <Td align="right" strong>{formatNumber(row.unit_quantity)}</Td>
              <Td align="right">{formatNumber(row.carton_quantity)}</Td>
              <Td mono>{row.master_bl_number || row.house_bl_number || row.master_awb_number || row.house_awb_number || "-"}</Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </Panel>
  );
}

function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="sticky top-0 border-b border-line-strong bg-sunken px-3 py-2 text-[11px] font-semibold text-slate-structure">{children}</th>;
}

function Td({ children, align = "left", mono = false, strong = false }: { children: React.ReactNode; align?: "left" | "right"; mono?: boolean; strong?: boolean }) {
  return (
    <td className={`px-3 py-2 align-middle ${align === "right" ? "text-right tabular-nums" : ""} ${mono ? "font-mono" : ""} ${strong ? "font-semibold text-ink" : "text-muted"}`}>
      {children}
    </td>
  );
}
