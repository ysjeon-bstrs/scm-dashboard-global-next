"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  BrandMark,
  PageHeader,
  Panel,
  PanelHeader,
  StatusPill,
} from "@/components/scm-dashboard/ui";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  DomesticStockBucketSummary,
  DomesticStockLotRow,
  DomesticStockSummary,
  DomesticStockSkuRow,
} from "@/lib/scm-dashboard/domesticStockQueries";
import type { UserSummary } from "@/lib/scm-dashboard/types";

interface DomesticStockClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

type SkuFilter = "all" | "running" | "excluded-only" | "inbound-waiting" | "high-excluded" | "expiry-risk";
type LotFilter = "all" | "running" | "excluded" | "inbound-waiting" | "issue";
type BucketGroup = "running" | "waiting" | "temporary" | "issue" | "keeping" | "other";

const emptySummary: DomesticStockSummary = {
  meta: {
    snapshot_date: null,
    warehouse_code: "DESIGN_KR",
    sku_count: 0,
    running_sku_count: 0,
    generated_at: "",
  },
  totals: {
    stock_running: 0,
    stock_total: 0,
    stock_excluded: 0,
    available_running: 0,
    delivery_wait_quantity: 0,
    lot_count: 0,
  },
  buckets: [],
  rows: [],
};

const CRITICAL_BUCKET_CODES = new Set(["lost", "defective", "disposal"]);

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  if (value === "1970-01-01") return "미지정";
  return value;
}

function formatPercent(numerator: number, denominator: number) {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function expiryDays(value: string | null | undefined) {
  if (!value || value === "1970-01-01") return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function isExpiryRisk(value: string | null | undefined) {
  const days = expiryDays(value);
  return days !== null && days < 365;
}

function bucketTone(bucket: Pick<DomesticStockBucketSummary, "bucket_code" | "include_in_running_stock">) {
  if (bucket.include_in_running_stock) return "ok" as const;
  if (bucket.bucket_code === "inbound_waiting") return "warn" as const;
  if (CRITICAL_BUCKET_CODES.has(bucket.bucket_code)) return "danger" as const;
  return "neutral" as const;
}

function bucketLabel(bucket: Pick<DomesticStockBucketSummary, "bucket_code" | "include_in_running_stock">) {
  if (bucket.include_in_running_stock) return "운영";
  if (bucket.bucket_code === "inbound_waiting") return "입고대기";
  if (CRITICAL_BUCKET_CODES.has(bucket.bucket_code)) return "관리필요";
  return "제외";
}

function expiryTone(date: string | null) {
  const days = expiryDays(date);
  if (days === null) return "neutral" as const;
  if (days < 180) return "danger" as const;
  if (days < 365) return "warn" as const;
  return "neutral" as const;
}

function stockTone(row: DomesticStockSkuRow) {
  if (row.stock_running > 0) return "ok" as const;
  if (row.stock_total > 0) return "warn" as const;
  return "neutral" as const;
}

function bucketGroup(bucket: Pick<DomesticStockBucketSummary, "bucket_code" | "warehouse_lname" | "include_in_running_stock">): BucketGroup {
  if (bucket.include_in_running_stock) return "running";
  if (bucket.bucket_code === "inbound_waiting") return "waiting";
  if (bucket.bucket_code.includes("temporary") || bucket.warehouse_lname.includes("임시")) return "temporary";
  if (CRITICAL_BUCKET_CODES.has(bucket.bucket_code) || /분실|불량|폐기/.test(bucket.warehouse_lname)) return "issue";
  if (bucket.bucket_code.includes("keeping") || bucket.warehouse_lname.toUpperCase().includes("KEEPING")) return "keeping";
  return "other";
}

function lotGroup(row: DomesticStockLotRow): BucketGroup {
  return bucketGroup(row);
}

function compactMetric(label: string, value: string, detail?: string, tone = "text-ink") {
  return (
    <div className="min-w-[8.5rem] rounded-lg border border-line bg-surface px-3 py-2">
      <p className="field-label">{label}</p>
      <p className={`mt-1 text-lg leading-none font-semibold tabular-nums ${tone}`}>{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-faint">{detail}</p> : null}
    </div>
  );
}

function filterLabel(filter: SkuFilter) {
  const labels: Record<SkuFilter, string> = {
    all: "전체",
    running: "운영재고 있음",
    "excluded-only": "제외재고만",
    "inbound-waiting": "입고대기 있음",
    "high-excluded": "제외비율 높음",
    "expiry-risk": "유통기한 1년내",
  };
  return labels[filter];
}

export default function DomesticStockClient({
  user,
  initialAuthError,
}: DomesticStockClientProps) {
  const [summary, setSummary] = useState<DomesticStockSummary>(emptySummary);
  const [lots, setLots] = useState<DomesticStockLotRow[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [skuFilter, setSkuFilter] = useState<SkuFilter>("all");
  const [lotFilter, setLotFilter] = useState<LotFilter>("all");
  const [includeExcluded, setIncludeExcluded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLotLoading, setIsLotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") {
      return "boosters.kr Google 계정만 접근할 수 있습니다.";
    }
    if (initialAuthError === "unauthenticated") {
      return "디자인KR 재고를 보려면 boosters.kr Google 계정으로 로그인하세요.";
    }
    return null;
  }, [initialAuthError]);

  const bucketGroups = useMemo(() => {
    const initial: Record<BucketGroup, { label: string; rows: number; stock: number; buckets: DomesticStockBucketSummary[] }> = {
      running: { label: "운영재고", rows: 0, stock: 0, buckets: [] },
      waiting: { label: "입고대기", rows: 0, stock: 0, buckets: [] },
      temporary: { label: "임시/배정", rows: 0, stock: 0, buckets: [] },
      issue: { label: "분실/불량/폐기", rows: 0, stock: 0, buckets: [] },
      keeping: { label: "KEEPING", rows: 0, stock: 0, buckets: [] },
      other: { label: "기타 제외", rows: 0, stock: 0, buckets: [] },
    };
    for (const bucket of summary.buckets) {
      const group = initial[bucketGroup(bucket)];
      group.rows += bucket.rows;
      group.stock += bucket.stock_quantity;
      group.buckets.push(bucket);
    }
    return initial;
  }, [summary.buckets]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summary.rows.filter((row) => {
      const matchesQuery =
        !needle ||
        row.product_code.toLowerCase().includes(needle) ||
        (row.product_name ?? "").toLowerCase().includes(needle);
      if (!matchesQuery) return false;

      if (skuFilter === "running") return row.stock_running > 0;
      if (skuFilter === "excluded-only") return row.stock_running <= 0 && row.stock_excluded > 0;
      if (skuFilter === "inbound-waiting") return row.delivery_wait_quantity > 0;
      if (skuFilter === "high-excluded") {
        return row.stock_total > 0 && row.stock_excluded / row.stock_total >= 0.2;
      }
      if (skuFilter === "expiry-risk") return isExpiryRisk(row.nearest_expiration_date);
      return true;
    });
  }, [query, skuFilter, summary.rows]);

  const filterCounts = useMemo(() => {
    const rows = summary.rows;
    return {
      all: rows.length,
      running: rows.filter((row) => row.stock_running > 0).length,
      "excluded-only": rows.filter((row) => row.stock_running <= 0 && row.stock_excluded > 0).length,
      "inbound-waiting": rows.filter((row) => row.delivery_wait_quantity > 0).length,
      "high-excluded": rows.filter((row) => row.stock_total > 0 && row.stock_excluded / row.stock_total >= 0.2).length,
      "expiry-risk": rows.filter((row) => isExpiryRisk(row.nearest_expiration_date)).length,
    } satisfies Record<SkuFilter, number>;
  }, [summary.rows]);

  const selectedRow = useMemo(() => {
    return summary.rows.find((row) => row.product_code === selectedSku) ?? null;
  }, [selectedSku, summary.rows]);

  const visibleLots = useMemo(() => {
    return lots.filter((row) => {
      if (lotFilter === "running") return row.include_in_running_stock;
      if (lotFilter === "excluded") return !row.include_in_running_stock;
      if (lotFilter === "inbound-waiting") return row.bucket_code === "inbound_waiting";
      if (lotFilter === "issue") return lotGroup(row) === "issue";
      return true;
    });
  }, [lotFilter, lots]);

  const excludedShare = formatPercent(
    summary.totals.stock_excluded,
    summary.totals.stock_total,
  );

  const loadLots = useCallback(
    async (sku: string, nextIncludeExcluded = includeExcluded) => {
      setIsLotLoading(true);
      setError(null);
      const params = new URLSearchParams({
        sku,
        include_excluded: nextIncludeExcluded ? "true" : "false",
        limit: "5000",
      });
      const response = await fetch(`/api/domestic-stock/lots?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setIsLotLoading(false);
        setError(`LOT API failed with ${response.status}.`);
        return;
      }
      const payload = (await response.json()) as { rows: DomesticStockLotRow[] };
      setLots(payload.rows);
      setIsLotLoading(false);
    },
    [includeExcluded],
  );

  const loadSummary = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/domestic-stock/summary", {
      cache: "no-store",
    });
    if (!response.ok) {
      setError(`Summary API failed with ${response.status}.`);
      setIsLoading(false);
      return;
    }
    const payload = (await response.json()) as DomesticStockSummary;
    setSummary(payload);
    const nextSku = selectedSku ?? payload.rows[0]?.product_code ?? null;
    setSelectedSku(nextSku);
    if (nextSku) await loadLots(nextSku);
    setIsLoading(false);
  }, [loadLots, selectedSku, user]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/domestic-stock`,
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

  function selectSku(row: DomesticStockSkuRow) {
    setSelectedSku(row.product_code);
    setLotFilter("all");
    void loadLots(row.product_code);
  }

  function toggleIncludeExcluded() {
    const next = !includeExcluded;
    setIncludeExcluded(next);
    if (!next && lotFilter !== "running") setLotFilter("running");
    if (selectedSku) void loadLots(selectedSku, next);
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected stock desk</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            디자인KR Root Stock
          </h1>
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
      <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-3">
        <PageHeader
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                Control Tower 보기
              </Link>
              <button className="btn btn-secondary" onClick={() => void loadSummary()} type="button">
                데이터 새로고침
              </button>
              <span className="max-w-[14rem] truncate px-1 text-sm text-muted">
                {user.email}
              </span>
              <button className="btn btn-secondary" onClick={signOut} type="button">
                로그아웃
              </button>
            </>
          }
          description="DesignKR은 생산 입고 이후 글로벌 보충과 국내 출고의 기준이 되는 한국 root stock입니다. 현재 운영재고는 DL_입고만 포함하고, 입고대기와 임시/관리 bucket은 분리해서 봅니다."
          eyebrow="Root stock workbench"
          title="디자인KR Root Stock"
        />

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel className="p-0">
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="ok">운영 기준: DL_입고</StatusPill>
                <StatusPill tone={summary.meta.snapshot_date ? "brand" : "warn"}>
                  스냅샷 {summary.meta.snapshot_date ?? "대기"}
                </StatusPill>
                <StatusPill tone="neutral">국내 B2B/택배/시딩은 현재 범위 밖</StatusPill>
                <span className="font-mono text-xs text-faint">
                  warehouse {summary.meta.warehouse_code}
                </span>
              </div>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
                이 화면은 DesignKR의 실제 가용 root stock을 확인하는 작업대입니다. CJUS, Amazon US 직납,
                TikTok, EU/UK/AE 보충 판단의 upstream 재고를 먼저 정리하고, 운영 제외 bucket을 숨기지 않습니다.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {compactMetric(
                "운영재고",
                formatNumber(summary.totals.stock_running),
                `${formatNumber(summary.meta.running_sku_count)} SKU`,
                "text-ok-ink",
              )}
              {compactMetric("총재고", formatNumber(summary.totals.stock_total), "BA SKU 기준")}
              {compactMetric("제외재고", formatNumber(summary.totals.stock_excluded), excludedShare, "text-warn-ink")}
              {compactMetric("입고대기", formatNumber(bucketGroups.waiting.stock), "운영 제외", "text-warn-ink")}
              {compactMetric("관리필요", formatNumber(bucketGroups.issue.stock), "분실/불량/폐기", "text-danger")}
              {compactMetric("LOT", formatNumber(summary.totals.lot_count), `${formatNumber(summary.meta.sku_count)} SKU`)}
            </div>
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
          <Panel>
            <PanelHeader title="Root stock 역할" meta="node/lane 모델 기준" />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              <RoleCard label="Root" title="생산 입고 기준 재고" text="생산사 입고 후 글로벌 보충 판단의 기준이 되는 재고입니다." />
              <RoleCard label="US" title="CJUS / Amazon US" text="시간이 충분하면 CJUS를 거치고, 런칭/BFCM은 UPS/SEND 직납 lane을 씁니다." />
              <RoleCard label="FBT" title="TikTok Shop" text="미국 TikTok Shop은 CJUS 재고에서 FBT 납품이 발생합니다." />
              <RoleCard label="EU/UK/AE" title="Non-US 확장" text="AcrossB NL/UK와 Amazon DE/UK/AE 보충의 upstream입니다." />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Bucket 운영 기준" meta="운영재고 vs 제외재고" />
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <BucketGroupCard group={bucketGroups.running} tone="ok" />
              <BucketGroupCard group={bucketGroups.waiting} tone="warn" />
              <BucketGroupCard group={bucketGroups.temporary} tone="neutral" />
              <BucketGroupCard group={bucketGroups.issue} tone="danger" />
              <BucketGroupCard group={bucketGroups.keeping} tone="neutral" />
              <BucketGroupCard group={bucketGroups.other} tone="neutral" />
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <Panel className="min-w-0">
            <div className="mb-3 flex flex-col gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <PanelHeader
                  meta={`${filteredRows.length.toLocaleString("ko-KR")} / ${summary.rows.length.toLocaleString("ko-KR")} SKU`}
                  title="SKU 재고"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="field-label flex min-w-[16rem] flex-col gap-1.5 normal-case tracking-normal text-muted">
                    SKU 또는 상품명 검색
                    <input
                      className="field"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="BA00022 또는 상품명"
                      value={query}
                    />
                  </label>
                  <button
                    className={`seg self-end ${includeExcluded ? "seg-on" : "seg-off"}`}
                    onClick={toggleIncludeExcluded}
                    type="button"
                  >
                    LOT 상세: {includeExcluded ? "제외 포함" : "운영재고만"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "running", "excluded-only", "inbound-waiting", "high-excluded", "expiry-risk"] as SkuFilter[]).map((filter) => (
                  <button
                    className={`seg ${skuFilter === filter ? "seg-on" : "seg-off"}`}
                    key={filter}
                    onClick={() => setSkuFilter(filter)}
                    type="button"
                  >
                    {filterLabel(filter)} {formatNumber(filterCounts[filter])}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-sunken text-[11px] font-semibold text-slate-structure">
                    <tr className="border-b border-line-strong">
                      <th className="px-3 py-2">상태</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">상품명</th>
                      <th className="px-3 py-2 text-right">운영재고</th>
                      <th className="px-3 py-2 text-right">총재고</th>
                      <th className="px-3 py-2 text-right">운영비율</th>
                      <th className="px-3 py-2 text-right">입고대기</th>
                      <th className="px-3 py-2 text-right">제외</th>
                      <th className="px-3 py-2 text-right">LOT</th>
                      <th className="min-w-[8.5rem] px-3 py-2">최근접 유통기한</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const active = row.product_code === selectedSku;
                      const runningRatio = row.stock_total > 0 ? row.stock_running / row.stock_total : 0;
                      return (
                        <tr
                          className={`cursor-pointer border-b border-line transition hover:bg-brand-softer ${
                            active ? "bg-brand-soft/70" : "bg-surface"
                          }`}
                          key={row.raw_key}
                          onClick={() => selectSku(row)}
                        >
                          <td className="px-3 py-2">
                            <StatusPill tone={stockTone(row)}>
                              {row.stock_running > 0 ? "운영" : row.stock_total > 0 ? "제외만" : "재고없음"}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-brand-ink">
                            {row.product_code}
                          </td>
                          <td className="max-w-[340px] px-3 py-2 text-ink">
                            <span className="line-clamp-1">{row.product_name}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-ok-ink">
                            {formatNumber(row.stock_running)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">
                            {formatNumber(row.stock_total)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {formatPercent(row.stock_running, row.stock_total)}
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                              <div className="h-full rounded-full bg-ok-ink" style={{ width: `${Math.min(runningRatio * 100, 100)}%` }} />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-warn-ink">
                            {formatNumber(row.delivery_wait_quantity)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-warn-ink">
                            {formatNumber(row.stock_excluded)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {formatNumber(row.lot_count)}
                          </td>
                          <td className="min-w-[8.5rem] px-3 py-2 whitespace-nowrap">
                            <StatusPill tone={expiryTone(row.nearest_expiration_date)}>
                              {formatDate(row.nearest_expiration_date)}
                            </StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-10 text-center text-sm text-muted" colSpan={10}>
                          검색 또는 필터 조건에 맞는 SKU가 없습니다.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>

          <Panel className="min-w-0 xl:sticky xl:top-4 xl:self-start">
            <PanelHeader
              meta={selectedSku ?? "SKU 선택"}
              title="LOT, 유통기한, 로케이션"
            />
            {selectedRow ? (
              <div className="mb-3 rounded-lg border border-line bg-sunken p-3">
                <p className="font-mono text-sm font-semibold text-brand-ink">{selectedRow.product_code}</p>
                <p className="mt-1 text-sm leading-5 text-ink">{selectedRow.product_name}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="field-label">운영</p>
                    <p className="mt-1 font-semibold tabular-nums text-ok-ink">
                      {formatNumber(selectedRow.stock_running)}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">입고대기</p>
                    <p className="mt-1 font-semibold tabular-nums text-warn-ink">
                      {formatNumber(selectedRow.delivery_wait_quantity)}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">제외</p>
                    <p className="mt-1 font-semibold tabular-nums text-warn-ink">
                      {formatNumber(selectedRow.stock_excluded)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mb-3 flex flex-wrap gap-2">
              {([
                ["all", "전체"],
                ["running", "운영"],
                ["excluded", "제외"],
                ["inbound-waiting", "입고대기"],
                ["issue", "관리필요"],
              ] as Array<[LotFilter, string]>).map(([value, label]) => (
                <button
                  className={`seg ${lotFilter === value ? "seg-on" : "seg-off"}`}
                  key={value}
                  onClick={() => setLotFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-sunken text-[11px] font-semibold text-slate-structure">
                    <tr className="border-b border-line-strong">
                      <th className="px-3 py-2">상태</th>
                      <th className="px-3 py-2">LOT</th>
                      <th className="min-w-[7rem] px-3 py-2">유통기한</th>
                      <th className="px-3 py-2">창고</th>
                      <th className="px-3 py-2 text-right">수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLots.map((row) => (
                      <tr className="border-b border-line bg-surface" key={row.raw_key}>
                        <td className="px-3 py-2">
                          <StatusPill tone={row.include_in_running_stock ? "ok" : bucketTone(row)}>
                            {row.include_in_running_stock ? "운영" : bucketLabel(row)}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2 font-mono text-ink">{row.lot}</td>
                        <td className="min-w-[7rem] px-3 py-2 whitespace-nowrap">
                          <StatusPill tone={expiryTone(row.expiration_date)}>
                            {formatDate(row.expiration_date)}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-ink">{row.warehouse_lname}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-faint">{row.location}</p>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                          {formatNumber(row.stock_quantity)}
                        </td>
                      </tr>
                    ))}
                    {visibleLots.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-sm text-muted" colSpan={5}>
                          SKU를 선택하거나 LOT 필터를 변경하세요.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </div>

        <Panel className="p-0">
          <div className="border-b border-line px-4 py-3">
            <PanelHeader title="Bucket 상세" meta="운영 제외 사유 확인" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs">
              <thead className="bg-sunken text-[11px] font-semibold text-slate-structure">
                <tr className="border-b border-line-strong">
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2">그룹</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">수량</th>
                  <th className="px-3 py-2 text-right">가용</th>
                  <th className="px-3 py-2 text-right">입고대기</th>
                  <th className="px-3 py-2">Code</th>
                </tr>
              </thead>
              <tbody>
                {summary.buckets.map((bucket) => (
                  <tr className="border-b border-line bg-surface" key={bucket.warehouse_lname}>
                    <td className="px-3 py-2 font-semibold text-ink">{bucket.warehouse_lname}</td>
                    <td className="px-3 py-2 text-muted">{bucketGroups[bucketGroup(bucket)].label}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={bucketTone(bucket)}>{bucketLabel(bucket)}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatNumber(bucket.rows)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                      {formatNumber(bucket.stock_quantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatNumber(bucket.available_stock_quantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-warn-ink">
                      {formatNumber(bucket.delivery_wait_quantity)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-faint">{bucket.bucket_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {isLoading || isLotLoading ? (
          <div className="fixed right-4 bottom-4 flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-paper shadow-pop">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-on-brand" />
            {isLoading ? "재고 요약 불러오는 중" : "LOT 상세 불러오는 중"}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function RoleCard({ label, text, title }: { label: string; text: string; title: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <p className="field-label normal-case tracking-normal text-brand-ink">{label}</p>
      <h2 className="mt-1 text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-xs leading-5 text-muted">{text}</p>
    </section>
  );
}

function BucketGroupCard({
  group,
  tone,
}: {
  group: { label: string; rows: number; stock: number };
  tone: "neutral" | "ok" | "warn" | "danger";
}) {
  const toneClass = {
    neutral: "text-ink",
    ok: "text-ok-ink",
    warn: "text-warn-ink",
    danger: "text-danger",
  }[tone];

  return (
    <section className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="field-label normal-case tracking-normal">{group.label}</p>
        <StatusPill tone={tone}>{formatNumber(group.rows)}</StatusPill>
      </div>
      <p className={`mt-2 text-lg leading-none font-semibold tabular-nums ${toneClass}`}>
        {formatNumber(group.stock)}
      </p>
    </section>
  );
}
