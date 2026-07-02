"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, BrandMark, PageHeader, Panel, PanelHeader, StatusPill } from "@/components/scm-dashboard/ui";
import type { AmazonDohCenterFilter, AmazonDohStatus, AmazonDohSummary, AmazonDohSummaryRow } from "@/lib/scm-dashboard/amazonDohQueries";
import type { AmazonStockRow, AmazonStockSummary } from "@/lib/scm-dashboard/amazonStockQueries";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type { UserSummary } from "@/lib/scm-dashboard/types";

interface AmazonStockClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

type StockFilter = "all" | "inbound" | "customer-order" | "low-stock";
type ActionFilter = "all" | "send-now" | "send-soon" | "incoming" | "fee-risk" | "ok" | "no-sales";

const CENTERS: AmazonDohCenterFilter[] = ["AMZUS", "AMZUK", "AMZDE", "AMZAE", "ALL"];

const emptyStockSummary: AmazonStockSummary = {
  meta: {
    latest_date: null,
    generated_at: "",
    row_count: 0,
    center_count: 0,
    sku_count: 0,
  },
  totals: {
    sku_count: 0,
    stock_sellable: 0,
    stock_available: 0,
    pending_fc: 0,
    stock_incoming: 0,
    stock_expected: 0,
    stock_processing: 0,
    stock_readytoship: 0,
    customer_order: 0,
    fc_processing: 0,
  },
  centers: [],
  rows: [],
};

const emptyDohSummary: AmazonDohSummary = {
  meta: {
    snapshot_date: null,
    sales_window_end_date: null,
    selected_center: "AMZUS",
    generated_at: "",
    row_count: 0,
    center_count: 0,
  },
  totals: {
    send_now_count: 0,
    send_soon_count: 0,
    watch_count: 0,
    watch_incoming_count: 0,
    ok_count: 0,
    no_sales_count: 0,
    fee_risk_count: 0,
    stock_sellable: 0,
    stock_incoming: 0,
    total_required_net: 0,
    total_recommended_ship_qty: 0,
  },
  centers: [],
  actions: [],
};

function formatNumber(value: number | null | undefined, digits = 0) {
  return Number(value ?? 0).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatDate(value: string | null | undefined) {
  return value || "-";
}

function inboundTotal(row: AmazonStockRow) {
  return Number(row.stock_expected ?? 0) + Number(row.stock_processing ?? 0) + Number(row.stock_readytoship ?? 0);
}

function centerTone(center: string) {
  if (center === "AMZUS") return "brand" as const;
  if (center === "AMZAE") return "warn" as const;
  return "neutral" as const;
}

function stockTone(row: AmazonStockRow) {
  if (row.stock_sellable <= 0 && inboundTotal(row) > 0) return "warn" as const;
  if (row.stock_sellable <= 0) return "danger" as const;
  if (inboundTotal(row) > 0) return "brand" as const;
  return "ok" as const;
}

function actionTone(status: AmazonDohStatus, feeRisk = false) {
  if (status === "CRITICAL_SEND_NOW") return "danger" as const;
  if (status === "SEND_SOON" || status === "WATCH") return "warn" as const;
  if (status === "WATCH_INCOMING") return "brand" as const;
  if (feeRisk) return "warn" as const;
  if (status === "OK") return "ok" as const;
  return "neutral" as const;
}

// Two-tier KPI: the two decision metrics (지금/권장 발송) render as emphasized bordered
// cards; the rest are quieter supporting figures. Color is reserved for meaning
// (danger = act now, warn = fee risk); everything else stays neutral ink.
function compactMetric(label: string, value: string, detail?: string, tone = "text-ink", primary = false) {
  return (
    <div className={primary ? "min-w-[8.5rem] rounded-lg border border-line bg-surface px-3 py-2.5" : "min-w-[8.5rem] px-3 py-2"}>
      <p className="field-label">{label}</p>
      <p className={`mt-1 ${primary ? "text-2xl" : "text-lg"} leading-none font-semibold tabular-nums ${tone}`}>{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-faint">{detail}</p> : null}
    </div>
  );
}

function centerLabel(center: AmazonDohCenterFilter) {
  if (center === "AMZUS") return "US";
  if (center === "AMZUK") return "UK";
  if (center === "AMZDE") return "DE/EU";
  if (center === "AMZAE") return "AE";
  return "All";
}

function filterAction(row: AmazonDohSummaryRow, filter: ActionFilter) {
  if (filter === "send-now") return row.status === "CRITICAL_SEND_NOW";
  if (filter === "send-soon") return row.status === "SEND_SOON" || row.status === "WATCH";
  if (filter === "incoming") return row.status === "WATCH_INCOMING";
  if (filter === "fee-risk") return row.fee_risk;
  if (filter === "ok") return row.status === "OK";
  if (filter === "no-sales") return row.status === "NO_SALES";
  return true;
}

type SortState<T> = { key: keyof T & string; dir: "asc" | "desc" };

// Stable client-side sort by a single field; numbers compare numerically, else localeCompare.
function sortRows<T>(rows: T[], sort: SortState<T> | null): T[] {
  if (!sort) return rows;
  const { key, dir } = sort;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] as unknown;
    const bv = b[key] as unknown;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av ?? "").localeCompare(String(bv ?? ""));
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

// Sortable header cell: click toggles asc/desc (numeric columns start descending for triage).
function SortTh<T>({ label, colKey, numeric = false, hint, sort, onSort }: {
  label: string;
  colKey: keyof T & string;
  numeric?: boolean;
  hint?: string;
  sort: SortState<T> | null;
  onSort: (key: keyof T & string, numeric: boolean) => void;
}) {
  const active = sort?.key === colKey;
  const arrow = active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th className={`px-3 py-2 ${numeric ? "text-right" : ""}`} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        className={`inline-flex items-center gap-1 font-semibold ${numeric ? "w-full justify-end" : ""} ${active ? "text-brand-ink" : "hover:text-ink"} ${hint ? "cursor-help" : ""}`}
        onClick={() => onSort(colKey, numeric)}
        title={hint}
        type="button"
      >
        {label}
        {hint ? <span className="text-[9px] text-faint" aria-hidden>ⓘ</span> : null}
        <span className={`text-[9px] ${active ? "text-brand" : "text-faint"}`} aria-hidden>{arrow}</span>
      </button>
    </th>
  );
}

export default function AmazonStockClient({ user, initialAuthError }: AmazonStockClientProps) {
  const [stockSummary, setStockSummary] = useState<AmazonStockSummary>(emptyStockSummary);
  const [dohSummary, setDohSummary] = useState<AmazonDohSummary>(emptyDohSummary);
  const [query, setQuery] = useState("");
  const [center, setCenter] = useState<AmazonDohCenterFilter>("AMZUS");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSort, setActionSort] = useState<SortState<AmazonDohSummaryRow> | null>(null);
  const [stockSort, setStockSort] = useState<SortState<AmazonStockRow> | null>(null);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") return "boosters.kr Google 계정만 접근할 수 있습니다.";
    if (initialAuthError === "unauthenticated") return "Amazon 보충 의사결정 화면을 보려면 boosters.kr Google 계정으로 로그인하세요.";
    return null;
  }, [initialAuthError]);

  const loadSummary = useCallback(async (nextCenter: AmazonDohCenterFilter) => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const stockUrl = nextCenter === "ALL" ? "/api/amazon-stock/summary" : `/api/amazon-stock/summary?center=${nextCenter}`;
      const dohUrl = `/api/amazon-doh/summary?center=${nextCenter}`;
      const [stockResponse, dohResponse] = await Promise.all([
        fetch(stockUrl, { cache: "no-store" }),
        fetch(dohUrl, { cache: "no-store" }),
      ]);
      if (!stockResponse.ok) throw new Error(`stock API ${stockResponse.status}`);
      if (!dohResponse.ok) throw new Error(`DOH API ${dohResponse.status}`);
      setStockSummary((await stockResponse.json()) as AmazonStockSummary);
      setDohSummary((await dohResponse.json()) as AmazonDohSummary);
    } catch (loadError) {
      console.error("Amazon data load failed:", loadError);
      setError("Amazon 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary("AMZUS");
  }, [loadSummary]);

  const filteredActionRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return dohSummary.actions.filter((row) => {
      if (!filterAction(row, actionFilter)) return false;
      if (!needle) return true;
      return row.resource_code.toLowerCase().includes(needle) || String(row.resource_name ?? "").toLowerCase().includes(needle);
    });
  }, [actionFilter, dohSummary.actions, query]);

  const filteredStockRows = useMemo(() => {
    const stockNameBySku = new Map<string, string>();
    for (const row of dohSummary.actions) {
      if (row.resource_name) stockNameBySku.set(row.resource_code, row.resource_name);
    }
    const needle = query.trim().toLowerCase();
    return stockSummary.rows.filter((row) => {
      const resourceName = row.resource_name ?? stockNameBySku.get(row.resource_code) ?? "";
      if (needle && !row.resource_code.toLowerCase().includes(needle) && !resourceName.toLowerCase().includes(needle)) return false;
      if (stockFilter === "inbound") return inboundTotal(row) > 0;
      if (stockFilter === "customer-order") return row.customer_order > 0;
      if (stockFilter === "low-stock") return row.stock_sellable <= 10;
      return true;
    }).map((row) => ({
      ...row,
      resource_name: row.resource_name ?? stockNameBySku.get(row.resource_code) ?? null,
    }));
  }, [dohSummary.actions, query, stockFilter, stockSummary.rows]);

  const filterCounts = useMemo(() => {
    const scoped = stockSummary.rows;
    return {
      all: scoped.length,
      inbound: scoped.filter((row) => inboundTotal(row) > 0).length,
      "customer-order": scoped.filter((row) => row.customer_order > 0).length,
      "low-stock": scoped.filter((row) => row.stock_sellable <= 10).length,
    } satisfies Record<StockFilter, number>;
  }, [stockSummary.rows]);

  const actionCounts = useMemo(() => ({
    all: dohSummary.actions.length,
    "send-now": dohSummary.totals.send_now_count,
    "send-soon": dohSummary.totals.send_soon_count + dohSummary.totals.watch_count,
    incoming: dohSummary.totals.watch_incoming_count,
    "fee-risk": dohSummary.totals.fee_risk_count,
    ok: dohSummary.totals.ok_count,
    "no-sales": dohSummary.totals.no_sales_count,
  } satisfies Record<ActionFilter, number>), [dohSummary]);

  const sortedActionRows = useMemo(() => sortRows(filteredActionRows, actionSort), [filteredActionRows, actionSort]);
  const sortedStockRows = useMemo(() => sortRows(filteredStockRows, stockSort), [filteredStockRows, stockSort]);

  const toggleActionSort = useCallback((key: keyof AmazonDohSummaryRow & string, numeric: boolean) => {
    setActionSort((cur) => (cur && cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));
  }, []);
  const toggleStockSort = useCallback((key: keyof AmazonStockRow & string, numeric: boolean) => {
    setStockSort((cur) => (cur && cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));
  }, []);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/amazon`,
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

  function changeCenter(nextCenter: AmazonDohCenterFilter) {
    setCenter(nextCenter);
    setActionFilter("all");
    setStockFilter("all");
    void loadSummary(nextCenter);
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected Amazon desk</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Amazon 보충 의사결정</h1>
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
    <main className="min-h-dvh px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[104rem] flex-col gap-3">
        <PageHeader
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                Control Tower 보기
              </Link>
              <button className="btn btn-secondary" disabled={isLoading} onClick={() => void loadSummary(center)} type="button">
                데이터 새로고침
              </button>
              <span className="max-w-[14rem] truncate px-1 text-sm text-muted">{user.email}</span>
              <button className="btn btn-secondary" onClick={signOut} type="button">
                로그아웃
              </button>
            </>
          }
          description="신규 code-owned mart 기준으로 판매속도, DOH, 입고 반영 후 필요수량을 계산합니다. 기본 범위는 US이며 UK, DE/EU, AE를 선택할 수 있습니다."
          eyebrow="Amazon replenishment"
          title="Amazon 보충 Action Center"
        />

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel className="p-0">
          <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="brand">mart_amazon_doh_snapshot</StatusPill>
                <StatusPill tone={dohSummary.meta.snapshot_date ? "ok" : "warn"}>
                  스냅샷 {formatDate(dohSummary.meta.snapshot_date)}
                </StatusPill>
                <StatusPill tone="neutral">판매 기준 {formatDate(dohSummary.meta.sales_window_end_date)} PT까지</StatusPill>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {CENTERS.map((value) => (
                  <button
                    className={`seg ${center === value ? "seg-on" : "seg-off"}`}
                    key={value}
                    onClick={() => changeCenter(value)}
                    type="button"
                  >
                    {centerLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {compactMetric("지금 발송", formatNumber(dohSummary.totals.send_now_count), "즉시 발송 필요 SKU", "text-danger", true)}
              {compactMetric("권장 발송", formatNumber(dohSummary.totals.total_recommended_ship_qty), "순부족 합계 (EA)", "text-danger", true)}
              {compactMetric("입고로 커버", formatNumber(dohSummary.totals.watch_incoming_count), "입고 대기로 관찰 중", "text-ink")}
              {compactMetric("Fee risk", formatNumber(dohSummary.totals.fee_risk_count), "US 한정", "text-warn-ink")}
              {compactMetric("Sellable", formatNumber(dohSummary.totals.stock_sellable), "선택 범위 판매가능 합계", "text-ink")}
              {compactMetric("Incoming", formatNumber(dohSummary.totals.stock_incoming), "입고예정 + 처리중 + 준비", "text-ink")}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="센터별 의사결정 요약" meta="선택 범위와 무관하게 전체 센터 표시" />
          {dohSummary.centers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-sunken px-3 py-6 text-center text-sm text-muted">{isLoading ? "센터 요약을 불러오는 중…" : "표시할 센터 요약 데이터가 없습니다."}</p>
          ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {dohSummary.centers.map((centerRow) => (
              <section className="rounded-xl border border-line bg-surface p-3" key={centerRow.center}>
                <div className="flex items-center justify-between gap-2">
                  <StatusPill tone={centerTone(centerRow.center)}>{centerRow.center}</StatusPill>
                  <span className="text-xs text-faint">{centerRow.row_count} SKU</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
                  <span>지금 발송</span>
                  <span className="text-right font-semibold tabular-nums text-danger">{formatNumber(centerRow.send_now_count)}</span>
                  <span>권장 수량</span>
                  <span className="text-right font-semibold tabular-nums text-danger">{formatNumber(centerRow.recommended_ship_qty)}</span>
                  <span>입고 커버</span>
                  <span className="text-right tabular-nums text-brand-ink">{formatNumber(centerRow.watch_incoming_count)}</span>
                  <span>median DOH</span>
                  <span className="text-right tabular-nums text-ink">{formatNumber(centerRow.median_doh_7d, 1)}</span>
                </div>
              </section>
            ))}
          </div>
          )}
        </Panel>

        <Panel className="min-w-0">
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <PanelHeader
                meta={`${filteredActionRows.length.toLocaleString("ko-KR")} / ${dohSummary.actions.length.toLocaleString("ko-KR")} rows`}
                title="Action Center"
              />
              <label className="field-label flex min-w-[18rem] flex-col gap-1.5 normal-case tracking-normal text-muted">
                SKU 또는 상품명 검색
                <input className="field" onChange={(event) => setQuery(event.target.value)} placeholder="BA00031, 콜라겐" value={query} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "전체"],
                ["send-now", "지금 발송"],
                ["send-soon", "이번 주"],
                ["incoming", "입고 커버"],
                ["fee-risk", "Fee risk"],
                ["ok", "정상"],
                ["no-sales", "판매 없음"],
              ] as Array<[ActionFilter, string]>).map(([value, label]) => (
                <button className={`seg ${actionFilter === value ? "seg-on" : "seg-off"}`} key={value} onClick={() => setActionFilter(value)} type="button">
                  {label} {formatNumber(actionCounts[value])}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-sunken text-[11px] font-semibold text-slate-structure">
                  <tr className="border-b border-line-strong">
                    <SortTh<AmazonDohSummaryRow> label="Action" colKey="action_label" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="Center" colKey="center" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="SKU / 상품" colKey="resource_code" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="권장 발송" colKey="recommended_ship_qty" numeric hint="입고 반영 후에도 부족한 순 필요 수량 = 지금 발송을 권장하는 양" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="Sellable" colKey="stock_sellable" numeric hint="현재 판매 가능한 재고 수량" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="Incoming" colKey="stock_incoming" numeric hint="입고 예정 합계 (입고예정 + 처리중 + 출고준비)" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="Vel 7d" colKey="vel_7d" numeric hint="Velocity — 최근 7일 일평균 판매량" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="DOH 7" colKey="doh_7d" numeric hint="Days on Hand — 최근 7일 판매속도 기준 재고 소진 예상 일수" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="DOH 30" colKey="doh_30d" numeric hint="최근 30일 판매속도 기준 재고 소진 예상 일수" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="DOH 90" colKey="doh_90d" numeric hint="최근 90일 판매속도 기준 재고 소진 예상 일수" sort={actionSort} onSort={toggleActionSort} />
                    <SortTh<AmazonDohSummaryRow> label="7d sales" colKey="qty_7d" numeric hint="최근 7일 판매 수량" sort={actionSort} onSort={toggleActionSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedActionRows.map((row) => (
                    <tr className="border-b border-line bg-surface transition hover:bg-brand-softer" key={row.raw_key}>
                      <td className="px-3 py-2"><span className="cursor-help" title={row.action_reason}><StatusPill tone={actionTone(row.status, row.fee_risk)}>{row.action_label}</StatusPill></span></td>
                      <td className="px-3 py-2"><StatusPill tone={centerTone(row.center)}>{row.center}</StatusPill></td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold text-brand-ink">{row.resource_code}</div>
                        <div className="mt-0.5 max-w-[18rem] truncate text-[11px] text-muted">{row.resource_name || "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-danger">{formatNumber(row.recommended_ship_qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ok-ink">{formatNumber(row.stock_sellable)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink">{formatNumber(row.stock_incoming)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{formatNumber(row.vel_7d, 1)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{formatNumber(row.doh_7d, 1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(row.doh_30d, 1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(row.doh_90d, 1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(row.qty_7d)}</td>
                    </tr>
                  ))}
                  {sortedActionRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-muted" colSpan={11}>{isLoading ? "데이터를 불러오는 중…" : "선택한 조건에 맞는 보충 의사결정 row가 없습니다."}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        <Panel className="min-w-0">
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <PanelHeader
                meta={`${filteredStockRows.length.toLocaleString("ko-KR")} / ${stockSummary.rows.length.toLocaleString("ko-KR")} rows`}
                title="Inventory detail"
              />
              <p className="text-xs text-faint">DOH 판단의 기초가 되는 신규 inventory snapshot입니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "전체"],
                ["inbound", "입고/처리 있음"],
                ["customer-order", "예약/주문 있음"],
                ["low-stock", "10개 이하"],
              ] as Array<[StockFilter, string]>).map(([value, label]) => (
                <button className={`seg ${stockFilter === value ? "seg-on" : "seg-off"}`} key={value} onClick={() => setStockFilter(value)} type="button">
                  {label} {formatNumber(filterCounts[value])}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[430px] overflow-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-sunken text-[11px] font-semibold text-slate-structure">
                  <tr className="border-b border-line-strong">
                    <th className="px-3 py-2">상태</th>
                    <SortTh<AmazonStockRow> label="Center" colKey="center" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="SKU / 상품" colKey="resource_code" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Sellable" colKey="stock_sellable" numeric hint="현재 판매 가능한 재고 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Available" colKey="stock_available" numeric hint="가용 재고 (예약/주문 제외)" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Pending FC" colKey="pending_fc" numeric hint="FC(주문처리센터) 입고 대기 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Expected" colKey="stock_expected" numeric hint="입고 예정 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Processing" colKey="stock_processing" numeric hint="입고 처리중 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Ready" colKey="stock_readytoship" numeric hint="출고 준비 완료 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Customer" colKey="customer_order" numeric hint="고객 주문(예약) 수량" sort={stockSort} onSort={toggleStockSort} />
                    <SortTh<AmazonStockRow> label="Latest update" colKey="latest_updated_at" sort={stockSort} onSort={toggleStockSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedStockRows.map((row) => (
                    <tr className="border-b border-line bg-surface transition hover:bg-brand-softer" key={row.raw_key}>
                      <td className="px-3 py-2"><StatusPill tone={stockTone(row)}>{inboundTotal(row) > 0 ? "입고중" : row.stock_sellable > 0 ? "재고" : "확인"}</StatusPill></td>
                      <td className="px-3 py-2"><StatusPill tone={centerTone(row.center)}>{row.center}</StatusPill></td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold text-brand-ink">{row.resource_code}</div>
                        <div className="mt-0.5 max-w-[18rem] truncate text-[11px] text-muted">{row.resource_name || "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ok-ink">{formatNumber(row.stock_sellable)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{formatNumber(row.stock_available)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(row.pending_fc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink">{formatNumber(row.stock_expected)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink">{formatNumber(row.stock_processing)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink">{formatNumber(row.stock_readytoship)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-warn-ink">{formatNumber(row.customer_order)}</td>
                      <td className="min-w-[10rem] px-3 py-2 font-mono text-[11px] whitespace-nowrap text-faint">{row.latest_updated_at ? row.latest_updated_at.slice(0, 10) : "-"}</td>
                    </tr>
                  ))}
                  {sortedStockRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-muted" colSpan={11}>{isLoading ? "데이터를 불러오는 중…" : "검색 또는 필터 조건에 맞는 Amazon 재고 row가 없습니다."}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        {isLoading ? (
          <div className="fixed right-4 bottom-4 flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-paper shadow-pop" role="status" aria-live="polite">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-on-brand motion-reduce:animate-none" />
            Amazon 의사결정 데이터 불러오는 중
          </div>
        ) : null}
      </div>
    </main>
  );
}
