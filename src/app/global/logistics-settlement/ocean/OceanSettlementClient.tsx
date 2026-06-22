"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  BrandMark,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
} from "@/components/scm-dashboard/ui";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  OceanAllocationListRow,
  OceanSettlementLineRow,
  OceanSettlementSummary,
} from "@/lib/scm-dashboard/logisticsSettlement/queries";
import type { UserSummary } from "@/lib/scm-dashboard/types";

type OceanSettlementClientProps = {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
};

type BlDrilldown = {
  allocations: OceanAllocationListRow[];
  settlementLines: OceanSettlementLineRow[];
};

const emptySummary: OceanSettlementSummary = {
  meta: {
    generatedAt: "",
    settlementMonth: null,
    rowCount: 0,
    blCount: 0,
    invoiceCount: 0,
  },
  totals: {
    qtyEa: 0,
    qtyCtn: 0,
    freightKrw: 0,
    dutyKrw: 0,
    otherKrw: 0,
    logisticsKrw: 0,
  },
  rows: [],
  exceptions: [],
};

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function formatKrw(value: number | null | undefined) {
  return `${formatNumber(value)}원`;
}

function formatCompactKrw(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (Math.abs(amount) >= 100_000_000) {
    return `${(amount / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
  }
  if (Math.abs(amount) >= 10_000) {
    return `${(amount / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만원`;
  }
  return formatKrw(amount);
}

function formatUnit(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function allocatedFreight(row: OceanAllocationListRow) {
  return row.skuFreightUnitKrw * row.qtyEa;
}

function allocatedDuty(row: OceanAllocationListRow) {
  return row.skuDutyUnitKrw * row.qtyEa;
}

function allocatedOther(row: OceanAllocationListRow) {
  return row.skuOtherUnitKrw * row.qtyEa;
}

export default function OceanSettlementClient({
  user,
  initialAuthError,
}: OceanSettlementClientProps) {
  const [summary, setSummary] = useState<OceanSettlementSummary>(emptySummary);
  const [month, setMonth] = useState("");
  const [blFilter, setBlFilter] = useState("");
  const [containerFilter, setContainerFilter] = useState("");
  const [dutyFilter, setDutyFilter] = useState<"" | "with-duty" | "without-duty">("");
  const [query, setQuery] = useState("");
  const [selectedBlNo, setSelectedBlNo] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<BlDrilldown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDrilldownLoading, setIsDrilldownLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") return "boosters.kr Google 계정만 접근할 수 있습니다.";
    if (initialAuthError === "unauthenticated") return "해상 정산 분석을 보려면 boosters.kr Google 계정으로 로그인하세요.";
    return null;
  }, [initialAuthError]);

  const loadSummary = useCallback(async () => {
    if (authMessage) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "2000" });
      const response = await fetch(`/api/logistics-settlement/ocean/summary?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "해상 정산 데이터를 불러오지 못했습니다.");
      setSummary(payload as OceanSettlementSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSummary(emptySummary);
    } finally {
      setIsLoading(false);
    }
  }, [authMessage]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  const monthOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.settlementMonth)),
    [summary.rows],
  );
  const blOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.blNo)),
    [summary.rows],
  );
  const containerOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.containerType || "미지정")),
    [summary.rows],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summary.rows.filter((row) => {
      if (month && row.settlementMonth !== month) return false;
      if (blFilter && row.blNo !== blFilter) return false;
      const container = row.containerType || "미지정";
      if (containerFilter && container !== containerFilter) return false;
      if (dutyFilter === "with-duty" && row.skuDutyUnitKrw <= 0) return false;
      if (dutyFilter === "without-duty" && row.skuDutyUnitKrw > 0) return false;
      if (!needle) return true;
      return [row.blNo, row.invoiceNo, row.resourceCode, row.resourceName, row.containerType]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [blFilter, containerFilter, dutyFilter, month, query, summary.rows]);

  const filteredStats = useMemo(() => {
    const blCount = new Set(filteredRows.map((row) => row.blNo).filter(Boolean)).size;
    const invoiceCount = new Set(filteredRows.map((row) => row.invoiceNo).filter(Boolean)).size;
    const qtyEa = filteredRows.reduce((sum, row) => sum + row.qtyEa, 0);
    const qtyCtn = filteredRows.reduce((sum, row) => sum + row.qtyCtn, 0);
    const freightKrw = filteredRows.reduce((sum, row) => sum + allocatedFreight(row), 0);
    const dutyKrw = filteredRows.reduce((sum, row) => sum + allocatedDuty(row), 0);
    const otherKrw = filteredRows.reduce((sum, row) => sum + allocatedOther(row), 0);
    const logisticsKrw = filteredRows.reduce((sum, row) => sum + row.skuLogisticsAllocKrw, 0);
    return {
      blCount,
      invoiceCount,
      qtyEa,
      qtyCtn,
      freightKrw,
      dutyKrw,
      otherKrw,
      logisticsKrw,
      avgLogisticsUnitKrw: qtyEa > 0 ? logisticsKrw / qtyEa : 0,
    };
  }, [filteredRows]);

  const hasActiveFilters = Boolean(month || blFilter || containerFilter || dutyFilter || query.trim());

  function clearFilters() {
    setMonth("");
    setBlFilter("");
    setContainerFilter("");
    setDutyFilter("");
    setQuery("");
  }

  const loadDrilldown = useCallback(async (blNo: string) => {
    setSelectedBlNo(blNo);
    setIsDrilldownLoading(true);
    setDrilldown(null);
    try {
      const response = await fetch(`/api/logistics-settlement/ocean/bl/${encodeURIComponent(blNo)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "BL 상세 데이터를 불러오지 못했습니다.");
      setDrilldown(payload as BlDrilldown);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsDrilldownLoading(false);
    }
  }, []);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/logistics-settlement/ocean`,
        },
      });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    }
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-12 text-ink">
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected settlement mart</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            해상 정산 분석
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">{authMessage}</p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button className="btn btn-primary mt-6" onClick={signInWithGoogle} type="button">
            Google로 로그인
          </button>
          <Link className="btn btn-secondary mt-3" href="/global/scm-dashboard">
            SCM Dashboard로 이동
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <PageHeader
          eyebrow="Global Logistics Settlement"
          title="해상 정산 분석"
          description="boosters_scm 이동 로그와 Supabase 정산 mart를 연결해 BL/SKU 단위 해상 운송비, 관세, 기타비용 배부 결과를 확인합니다."
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                SCM Dashboard
              </Link>
              <button className="btn btn-primary" disabled={isLoading || Boolean(authMessage)} onClick={() => void loadSummary()}>
                {isLoading ? "새로고침 중" : "새로고침"}
              </button>
            </>
          }
        />

        {authMessage ? <Banner tone="warn">{authMessage}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel>
          <div className="grid gap-3 lg:grid-cols-[9rem_12rem_10rem_10rem_1fr_auto] lg:items-end">
            <label className="block">
              <span className="field-label">정산월</span>
              <select
                className="input mt-1 w-full"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              >
                <option value="">전체</option>
                {monthOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">BL</span>
              <select
                className="input mt-1 w-full"
                value={blFilter}
                onChange={(event) => setBlFilter(event.target.value)}
              >
                <option value="">전체 BL</option>
                {blOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Container</span>
              <select
                className="input mt-1 w-full"
                value={containerFilter}
                onChange={(event) => setContainerFilter(event.target.value)}
              >
                <option value="">전체</option>
                {containerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">관세 상태</span>
              <select
                className="input mt-1 w-full"
                value={dutyFilter}
                onChange={(event) => setDutyFilter(event.target.value as "" | "with-duty" | "without-duty")}
              >
                <option value="">전체</option>
                <option value="with-duty">관세 있음</option>
                <option value="without-duty">관세 없음</option>
              </select>
            </label>
            <label className="block">
              <span className="field-label">검색</span>
              <input
                className="input mt-1 w-full"
                placeholder="SKU 코드, 상품명, BL, Invoice 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={!hasActiveFilters}
              onClick={clearFilters}
              type="button"
            >
              필터 초기화
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <span>
              KPI와 테이블은 현재 필터 기준입니다. DUTY만 관세, CUSTOMS는 통관수수료로 기타에 포함합니다.
            </span>
            <span>
              {user ? `${user.email} · ` : ""}
              {summary.meta.generatedAt ? `generated ${summary.meta.generatedAt.slice(0, 19)}` : "mart 대기"}
            </span>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Panel><Stat label="BL / Invoice" value={`${formatNumber(filteredStats.blCount)} BL`} hint={`${formatNumber(filteredStats.invoiceCount)} invoices`} /></Panel>
          <Panel><Stat label="출고 수량" value={`${formatNumber(filteredStats.qtyEa)} EA`} hint={`${formatNumber(filteredStats.qtyCtn)} CTN`} /></Panel>
          <Panel><Stat label="총 정산 물류비" value={formatCompactKrw(filteredStats.logisticsKrw)} tone="ok" hint={formatKrw(filteredStats.logisticsKrw)} /></Panel>
          <Panel><Stat label="평균 물류비/EA" value={`${formatUnit(filteredStats.avgLogisticsUnitKrw)}원`} tone="brand" hint="총 배부액 ÷ EA" /></Panel>
          <Panel><Stat label="운송비" value={formatCompactKrw(filteredStats.freightKrw)} tone="brand" hint={formatKrw(filteredStats.freightKrw)} /></Panel>
          <Panel><Stat label="관세 / 기타" value={formatCompactKrw(filteredStats.dutyKrw)} tone="warn" hint={`기타 ${formatCompactKrw(filteredStats.otherKrw)}`} /></Panel>
        </div>

        <Panel>
          <PanelHeader
            title="BL × SKU allocation"
            eyebrow="Ocean MVP"
            meta={`${formatNumber(filteredRows.length)} / ${formatNumber(summary.rows.length)} rows`}
          />
          <div className="overflow-auto rounded-xl border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">월</th>
                  <th className="px-3 py-2 text-left">BL</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-right">EA</th>
                  <th className="px-3 py-2 text-right">운송/EA</th>
                  <th className="px-3 py-2 text-right">관세/EA</th>
                  <th className="px-3 py-2 text-right">기타/EA</th>
                  <th className="px-3 py-2 text-right">총/EA</th>
                  <th className="px-3 py-2 text-right">총 배부액</th>
                  <th className="px-3 py-2 text-left">Container</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {filteredRows.map((row) => (
                  <tr key={row.rawKey} className="hover:bg-surface-muted/60">
                    <td className="px-3 py-2 tabular-nums text-faint">{row.settlementMonth || "-"}</td>
                    <td className="px-3 py-2">
                      <button className="text-brand-ink underline-offset-2 hover:underline" onClick={() => void loadDrilldown(row.blNo)}>
                        {row.blNo || "-"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-faint">{row.invoiceNo || "-"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{row.resourceCode}</div>
                      <div className="max-w-[18rem] truncate text-xs text-faint">{row.resourceName}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.qtyEa)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuFreightUnitKrw)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuDutyUnitKrw)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuOtherUnitKrw)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatUnit(row.skuLogisticsUnitKrw)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKrw(row.skuLogisticsAllocKrw)}</td>
                    <td className="px-3 py-2"><StatusPill tone={/20/.test(row.containerType) ? "warn" : "neutral"}>{row.containerType || "미지정"}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          <Panel>
            <PanelHeader title="Exception summary" meta="MVP checks" />
            <div className="space-y-2">
              {summary.exceptions.map((item) => (
                <div key={item.code} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <StatusPill tone={item.tone}>{item.label}</StatusPill>
                  <span className="font-semibold tabular-nums">{formatNumber(item.count)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="BL drilldown" meta={selectedBlNo ?? "BL 선택"} />
            {isDrilldownLoading ? <p className="text-sm text-muted">상세를 불러오는 중입니다.</p> : null}
            {!isDrilldownLoading && !drilldown ? <p className="text-sm text-muted">왼쪽 테이블에서 BL을 선택하세요.</p> : null}
            {drilldown ? (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="field-label mb-2">정산 원본 라인</p>
                  <div className="max-h-56 overflow-auto rounded-lg border border-line">
                    <table className="min-w-full divide-y divide-line text-xs">
                      <tbody className="divide-y divide-line">
                        {drilldown.settlementLines.map((line) => (
                          <tr key={line.rawKey}>
                            <td className="px-2 py-1">{line.invoiceDate}</td>
                            <td className="px-2 py-1">{line.country}</td>
                            <td className="px-2 py-1">{line.chargeType}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{formatKrw(line.amountKrw + line.taxKrw)}</td>
                            <td className="px-2 py-1">{line.containerType}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="field-label mb-2">배부 라인</p>
                  <p className="text-muted">{formatNumber(drilldown.allocations.length)} SKU rows</p>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </main>
  );
}
