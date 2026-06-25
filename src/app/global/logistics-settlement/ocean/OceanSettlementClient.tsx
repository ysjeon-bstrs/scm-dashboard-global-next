"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Banner,
  BrandMark,
  Collapsible,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
  type Tone,
} from "@/components/scm-dashboard/ui";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  LogisticsSettlementSummary,
  MonthlySkuCostRow,
  OceanSettlementLineRow,
  ShipmentAnalysisRow,
} from "@/lib/scm-dashboard/logisticsSettlement/queries";
import type { UserSummary } from "@/lib/scm-dashboard/types";

type OceanSettlementClientProps = {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
};

type TabKey = "jobs" | "analysis" | "ocean-source" | "monthly";

const emptySummary: LogisticsSettlementSummary = {
  meta: {
    generatedAt: "",
    rowCount: 0,
    analyzedRowCount: 0,
    pendingRowCount: 0,
    analyzedEa: 0,
    totalEa: 0,
    modes: [],
  },
  totals: {
    qtyEa: 0,
    qtyCtn: 0,
    analyzedQtyEa: 0,
    freightKrw: 0,
    dutyKrw: 0,
    otherKrw: 0,
    logisticsKrw: 0,
  },
  rows: [],
  oceanSettlementRows: [],
  monthlyRows: [],
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

function uniqueSorted(values: string[], direction: "asc" | "desc" = "asc") {
  const out = Array.from(new Set(values.filter(Boolean)));
  return out.sort((a, b) => direction === "desc" ? b.localeCompare(a) : a.localeCompare(b));
}

function monthOf(date: string | null) {
  return date ? date.slice(0, 7) : "";
}

function allocatedFreight(row: ShipmentAnalysisRow) {
  return row.skuFreightUnitKrw * row.qtyEa;
}

function allocatedDuty(row: ShipmentAnalysisRow) {
  return row.skuDutyUnitKrw * row.qtyEa;
}

function allocatedOther(row: ShipmentAnalysisRow) {
  return row.skuOtherUnitKrw * row.qtyEa;
}

export default function OceanSettlementClient({
  user,
  initialAuthError,
}: OceanSettlementClientProps) {
  const [summary, setSummary] = useState<LogisticsSettlementSummary>(emptySummary);
  const [activeTab, setActiveTab] = useState<TabKey>("jobs");
  const [shipMonth, setShipMonth] = useState("");
  const [settlementMonth, setSettlementMonth] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "analyzed" | "pending">("");
  const [blFilter, setBlFilter] = useState("");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") return "boosters.kr Google 계정만 접근할 수 있습니다.";
    if (initialAuthError === "unauthenticated") return "글로벌 정산 분석을 보려면 boosters.kr Google 계정으로 로그인하세요.";
    return null;
  }, [initialAuthError]);

  const loadSummary = useCallback(async () => {
    if (authMessage) return;
    // Race guard: only the most recently started load may commit state, so a slow
    // earlier request (or recompute's auto-refresh) can't overwrite newer data.
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/logistics-settlement/summary?limit=5000", { cache: "no-store" });
      const payload = await response.json();
      if (requestId !== loadRequestId.current) return;
      if (!response.ok) throw new Error(payload.error ?? "정산 분석 데이터를 불러오지 못했습니다.");
      setSummary(payload as LogisticsSettlementSummary);
    } catch (err) {
      if (requestId !== loadRequestId.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
      setSummary(emptySummary);
    } finally {
      if (requestId === loadRequestId.current) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [authMessage]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  const shipMonthOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => monthOf(row.shipDate)), "desc"),
    [summary.rows],
  );
  const settlementMonthOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.settlementMonth), "desc"),
    [summary.rows],
  );
  const modeOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.carrierMode)),
    [summary.rows],
  );
  const blOptions = useMemo(
    () => uniqueSorted(summary.rows.map((row) => row.blNo), "desc"),
    [summary.rows],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summary.rows.filter((row) => {
      if (shipMonth && monthOf(row.shipDate) !== shipMonth) return false;
      if (settlementMonth && row.settlementMonth !== settlementMonth) return false;
      if (modeFilter && row.carrierMode !== modeFilter) return false;
      if (statusFilter && row.analysisStatus !== statusFilter) return false;
      if (blFilter && row.blNo !== blFilter) return false;
      if (!needle) return true;
      return [row.invoiceNo, row.blNo, row.carrier, row.carrierMode, row.resourceCode, row.resourceName, row.fromWarehouse, row.toWarehouse]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [blFilter, modeFilter, query, settlementMonth, shipMonth, statusFilter, summary.rows]);

  const filteredStats = useMemo(() => {
    const analyzedRows = filteredRows.filter((row) => row.analysisStatus === "analyzed");
    const qtyEa = filteredRows.reduce((sum, row) => sum + row.qtyEa, 0);
    const analyzedQtyEa = analyzedRows.reduce((sum, row) => sum + row.qtyEa, 0);
    const logisticsKrw = analyzedRows.reduce((sum, row) => sum + row.skuLogisticsAllocKrw, 0);
    return {
      rowCount: filteredRows.length,
      analyzedRowCount: analyzedRows.length,
      pendingRowCount: filteredRows.length - analyzedRows.length,
      qtyEa,
      qtyCtn: filteredRows.reduce((sum, row) => sum + row.qtyCtn, 0),
      analyzedQtyEa,
      analyzedRate: filteredRows.length ? analyzedRows.length / filteredRows.length : 0,
      freightKrw: analyzedRows.reduce((sum, row) => sum + allocatedFreight(row), 0),
      dutyKrw: analyzedRows.reduce((sum, row) => sum + allocatedDuty(row), 0),
      otherKrw: analyzedRows.reduce((sum, row) => sum + allocatedOther(row), 0),
      logisticsKrw,
      avgLogisticsUnitKrw: analyzedQtyEa > 0 ? logisticsKrw / analyzedQtyEa : 0,
    };
  }, [filteredRows]);

  const filteredOceanRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summary.oceanSettlementRows.filter((row) => {
      if (blFilter && row.blNo !== blFilter) return false;
      if (settlementMonth && !String(row.invoiceDate ?? "").startsWith(settlementMonth)) return false;
      if (!needle) return true;
      return [row.blNo, row.chargeType, row.country, row.containerType, row.fileName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [blFilter, query, settlementMonth, summary.oceanSettlementRows]);

  const filteredMonthlyRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summary.monthlyRows.filter((row) => {
      if (settlementMonth && row.month !== settlementMonth) return false;
      if (modeFilter && row.carrierMode !== modeFilter) return false;
      if (!needle) return true;
      return [row.month, row.carrierMode, row.resourceCode, row.resourceName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [modeFilter, query, settlementMonth, summary.monthlyRows]);

  const hasActiveFilters = Boolean(shipMonth || settlementMonth || modeFilter || statusFilter || blFilter || query.trim());

  function clearFilters() {
    setShipMonth("");
    setSettlementMonth("");
    setModeFilter("");
    setStatusFilter("");
    setBlFilter("");
    setQuery("");
  }

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/logistics-settlement`,
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
            글로벌 정산 분석
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
      <div className="mx-auto flex max-w-[96rem] flex-col gap-5">
        <PageHeader
          eyebrow="Global Logistics Settlement"
          title="글로벌 정산 분석"
          description="SCM 이동/발송 원장을 기본으로 깔고, 정산 분석이 완료된 행에만 SKU별 운송비·관세·기타비용 배부 결과를 표시합니다."
          actions={
            <>
              <Link className="btn btn-secondary" href="/global/scm-dashboard">
                SCM Dashboard
              </Link>
              <button className="btn btn-primary" disabled={isLoading} aria-busy={isLoading} onClick={() => void loadSummary()}>
                {isLoading ? "새로고침 중" : "새로고침"}
              </button>
            </>
          }
        />

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {isLoading && !hasLoaded ? <Banner>정산 데이터를 불러오는 중…</Banner> : null}

        <Panel>
          <div className="grid gap-3 lg:grid-cols-[9rem_9rem_9rem_9rem_12rem_1fr_auto] lg:items-end">
            <SelectFilter label="출고월" value={shipMonth} onChange={setShipMonth} options={shipMonthOptions} allLabel="전체" />
            <SelectFilter label="정산월" value={settlementMonth} onChange={setSettlementMonth} options={settlementMonthOptions} allLabel="전체" />
            <SelectFilter label="Mode" value={modeFilter} onChange={setModeFilter} options={modeOptions} allLabel="전체" />
            <label className="block">
              <span className="field-label">정산상태</span>
              <select
                className="input mt-1 w-full"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "" | "analyzed" | "pending")}
              >
                <option value="">전체</option>
                <option value="analyzed">분석완료</option>
                <option value="pending">미분석</option>
              </select>
            </label>
            <SelectFilter label="BL" value={blFilter} onChange={setBlFilter} options={blOptions} allLabel="전체 BL" />
            <label className="block">
              <span className="field-label">검색</span>
              <input
                className="input mt-1 w-full"
                aria-label="발송/정산 행 검색"
                placeholder="Invoice, BL, SKU, 상품명, 창고 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="btn btn-secondary" disabled={!hasActiveFilters} onClick={clearFilters} type="button">
              필터 초기화
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <span>
              SKU 배부 분석은 전체 발송 원장 기준입니다. 분석 전 행은 비용 컬럼을 비워 두고, DUTY만 관세이며 CUSTOMS는 기타비용입니다.
            </span>
            <span>{user.email} · {summary.meta.generatedAt ? `generated ${summary.meta.generatedAt.slice(0, 19)}` : "mart 대기"}</span>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Panel><Stat label="전체 발송 row" value={formatNumber(filteredStats.rowCount)} hint={`미분석 ${formatNumber(filteredStats.pendingRowCount)} rows`} /></Panel>
          <Panel><Stat label="분석 완료율" value={`${(filteredStats.analyzedRate * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`} hint={`${formatNumber(filteredStats.analyzedRowCount)} analyzed`} tone="ok" /></Panel>
          <Panel><Stat label="전체 발송 수량" value={`${formatNumber(filteredStats.qtyEa)} EA`} hint={`${formatNumber(filteredStats.qtyCtn)} CTN`} /></Panel>
          <Panel><Stat label="총 배부 물류비" value={formatCompactKrw(filteredStats.logisticsKrw)} tone="ok" hint={formatKrw(filteredStats.logisticsKrw)} /></Panel>
          <Panel><Stat label="평균 물류비/EA" value={`${formatUnit(filteredStats.avgLogisticsUnitKrw)}원`} tone="brand" hint="분석완료 EA 기준" /></Panel>
          <Panel><Stat label="운송 / 관세 / 기타" value={formatCompactKrw(filteredStats.freightKrw)} tone="brand" hint={`관세 ${formatCompactKrw(filteredStats.dutyKrw)} · 기타 ${formatCompactKrw(filteredStats.otherKrw)}`} /></Panel>
        </div>

        <div className="flex flex-wrap gap-2">
          <TabButton active={activeTab === "jobs"} onClick={() => setActiveTab("jobs")}>적재/분석 작업</TabButton>
          <TabButton active={activeTab === "analysis"} onClick={() => setActiveTab("analysis")}>SKU 배부 분석</TabButton>
          <TabButton active={activeTab === "ocean-source"} onClick={() => setActiveTab("ocean-source")}>해상_정산 원천</TabButton>
          <TabButton active={activeTab === "monthly"} onClick={() => setActiveTab("monthly")}>월별 SKU 단가</TabButton>
        </div>

        {activeTab === "jobs" ? <SettlementJobsPanel onRefresh={() => void loadSummary()} /> : null}
        {activeTab === "analysis" ? <AnalysisTable rows={filteredRows} /> : null}
        {activeTab === "ocean-source" ? <OceanSourceTable rows={filteredOceanRows} /> : null}
        {activeTab === "monthly" ? <MonthlyTable rows={filteredMonthlyRows} /> : null}
      </div>
    </main>
  );
}

function SettlementJobsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [month, setMonth] = useState("");
  const [limit, setLimit] = useState("100");
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [confirmingApply, setConfirmingApply] = useState(false);

  async function runJob(endpoint: string, body?: Record<string, unknown>, runKey: string = endpoint) {
    setIsRunning(runKey);
    setJobError(null);
    setResult(null);
    try {
      const response = await fetch(endpoint, body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : { method: "GET", cache: "no-store" });
      const payload = await response.json();
      setResult(payload);
      if (!response.ok) {
        throw new Error(payload.errors?.[0]?.message ?? payload.error ?? "작업 실행 실패");
      }
      if (body?.apply === true) onRefresh();
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRunning(null);
    }
  }

  const parsedLimit = Number(limit || 0);
  const scope = { month: month || undefined, limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined };

  return (
    <Panel>
      <PanelHeader
        eyebrow="M1 Supabase-first console"
        title="DB 적재/분석 작업"
        meta="Staging 현황 → SKU 배부 재계산 → 검증"
      />
      <div className="grid gap-3 lg:grid-cols-[10rem_10rem_1fr] lg:items-end">
        <label className="block">
          <span className="field-label">정산월/출고월</span>
          <input className="input mt-1 w-full" aria-label="정산월/출고월 (YYYY-MM)" inputMode="numeric" placeholder="YYYY-MM" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">테스트 limit</span>
          <input className="input mt-1 w-full" aria-label="테스트 limit (행 수)" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <div className="text-xs leading-5 text-faint">
          M1 운영 기준은 Supabase DB입니다. 과거 Sheet 데이터는 관리자 CLI로 bootstrap하고, 웹은 staging/mart 현황 확인·재계산·검증만 수행합니다. 향후 신규 정산서는 Google Drive 보관소로 적재한 뒤 Drive source registry를 통해 검색/적재/분석합니다.
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <JobActionCard
          title="1. DB 적재 현황"
          description="Supabase stg_settlement_ocean_lines 기준 row/BL/file/금액 현황을 확인합니다."
          button="현황 확인"
          disabled={Boolean(isRunning)}
          running={isRunning === "/api/logistics-settlement/jobs/staging-status"}
          onClick={() => void runJob("/api/logistics-settlement/jobs/staging-status")}
        />
        <JobActionCard
          title="2. 재계산 미리보기"
          description="쓰기 없이 dry-run으로 배부 결과와 교체될 stale mart 행 수(cleanup)를 미리 확인합니다."
          button="미리보기 (dry-run)"
          disabled={Boolean(isRunning)}
          running={isRunning === "recompute:dry-run"}
          onClick={() => void runJob("/api/logistics-settlement/jobs/recompute", { ...scope, apply: false }, "recompute:dry-run")}
        />
        <JobActionCard
          title="3. SKU 배부 재계산"
          description="doc_analysis/monthly mart를 재계산하고 stale 행을 교체합니다. 적용은 full 런(월 비움)에서만 가능 — 월을 지정하면 미리보기/검증 전용입니다."
          button={month.trim() ? "월 지정 시 적용 불가" : "재계산 적용"}
          disabled={Boolean(isRunning) || Boolean(month.trim())}
          running={isRunning === "recompute:apply"}
          tone="warn"
          onClick={() => setConfirmingApply(true)}
        />
        <JobActionCard
          title="4. 검증"
          description="원천/이동/배부 row와 warning을 PASS/WARN/FAIL로 확인합니다."
          button="검증 실행"
          disabled={Boolean(isRunning)}
          running={isRunning === "/api/logistics-settlement/jobs/validate"}
          onClick={() => void runJob("/api/logistics-settlement/jobs/validate", scope)}
        />
        <JobActionCard
          title="5. 결과 새로고침"
          description="재계산 후 SKU 배부 분석, 해상_정산 원천, 월별 SKU 단가 탭을 다시 불러옵니다."
          button="화면 새로고침"
          disabled={Boolean(isRunning)}
          running={false}
          onClick={onRefresh}
        />
      </div>
      {confirmingApply ? (
        <div className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          <p className="font-semibold">재계산을 적용할까요?</p>
          <p className="mt-1 leading-6">
            {scope.month ? `${scope.month} ` : "전체 "}범위의 doc_analysis/monthly mart를 덮어쓰고 대상 범위의 stale 행을 삭제합니다.
            {scope.limit ? " (limit 지정 → 부분 실행이라 stale 정리는 건너뜁니다.)" : ""} 적용 전 “미리보기”로 영향 범위를 확인하세요.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-primary"
              type="button"
              disabled={Boolean(isRunning)}
              onClick={() => {
                setConfirmingApply(false);
                void runJob("/api/logistics-settlement/jobs/recompute", { ...scope, apply: true, confirmation: "APPLY_OCEAN_RECOMPUTE" }, "recompute:apply");
              }}
            >
              적용 실행
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setConfirmingApply(false)}>
              취소
            </button>
          </div>
        </div>
      ) : null}
      {jobError ? <Banner tone="danger">{jobError}</Banner> : null}
      {result ? <JobResultView result={result} /> : null}
    </Panel>
  );
}

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" ? (value as LooseRecord) : {};
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const JOB_STATUS_TONE: Record<string, Tone> = {
  SUCCEEDED: "ok",
  SUCCEEDED_WITH_WARNINGS: "warn",
  FAILED: "danger",
  BLOCKED: "warn",
};

const CHECK_TONE: Record<string, Tone> = { PASS: "ok", WARN: "warn", FAIL: "danger" };

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-[0.7rem] text-faint">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function JobResultView({ result }: { result: unknown }) {
  const root = asRecord(result);
  const status = typeof root.status === "string" ? root.status : null;
  const summary = asRecord(root.summary);
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const errors = Array.isArray(root.errors) ? root.errors : [];
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  const cleanup = asRecord(summary.cleanup);
  const written = asRecord(summary.written);
  const isRecompute = summary.allocationRowCount !== undefined;
  const isStaging = !status && summary.rowCount !== undefined;

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-muted p-4" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">최근 작업 결과</span>
        {status ? (
          <StatusPill tone={JOB_STATUS_TONE[status] ?? "neutral"}>{status}</StatusPill>
        ) : root.ok === false ? (
          <StatusPill tone="danger">실패</StatusPill>
        ) : root.ok === true ? (
          <StatusPill tone="ok">완료</StatusPill>
        ) : null}
        {typeof root.step === "string" ? <span className="text-xs text-faint">{root.step}</span> : null}
        {typeof root.etlRunId === "string" ? <span className="text-xs tabular-nums text-faint">{root.etlRunId}</span> : null}
      </div>

      {isRecompute ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="이동 row" value={formatNumber(asNumber(summary.movementRowCount))} />
          <Metric label="정산 row" value={formatNumber(asNumber(summary.settlementRowCount))} />
          <Metric label="배부 row" value={formatNumber(asNumber(summary.allocationRowCount))} />
          <Metric label="월별 row" value={formatNumber(asNumber(summary.monthlyRowCount))} />
          <Metric label="총 배부 물류비" value={formatKrw(asNumber(asRecord(summary.totals).logisticsKrw))} />
          <Metric label="warning" value={formatNumber(asNumber(summary.warningCount))} />
          <Metric
            label={cleanup.eligible ? `정리(${String(cleanup.scope ?? "")}${cleanup.month ? ` ${String(cleanup.month)}` : ""})` : "정리 (건너뜀)"}
            value={`mart ${formatNumber(asNumber(cleanup.martRowsAffected))} · 월별 ${formatNumber(asNumber(cleanup.monthlyRowsAffected))}`}
          />
          {written.mart ? (
            <Metric label="기록 mart · 월별" value={`${formatNumber(asNumber(asRecord(written.mart).written))} · ${formatNumber(asNumber(asRecord(written.monthly).written))}`} />
          ) : (
            <Metric label="모드" value={String(summary.mode ?? "")} />
          )}
        </div>
      ) : null}

      {isStaging ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="row" value={formatNumber(asNumber(summary.rowCount))} />
          <Metric label="BL" value={formatNumber(asNumber(summary.blCount))} />
          <Metric label="file" value={formatNumber(asNumber(summary.fileCount))} />
          <Metric label="최근 업데이트" value={typeof summary.latestUpdatedAt === "string" ? summary.latestUpdatedAt.slice(0, 19) : "-"} />
        </div>
      ) : null}

      {checks.length ? (
        <div className="mt-3 space-y-1.5">
          {checks.map((check, index) => {
            const row = asRecord(check);
            const checkStatus = String(row.status ?? "");
            return (
              <div key={index} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-xs">
                <span className="flex items-center gap-2">
                  <StatusPill tone={CHECK_TONE[checkStatus] ?? "neutral"}>{checkStatus}</StatusPill>
                  <span className="text-ink">{String(row.label ?? row.code ?? "")}</span>
                </span>
                <span className="tabular-nums text-faint">{String(row.actual ?? "")}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {warnings.length ? (
        <p className="mt-3 text-xs text-warn-ink">
          경고 {warnings.length}건: {warnings.slice(0, 3).map((warning) => String(asRecord(warning).message ?? "")).join(" · ")}
          {warnings.length > 3 ? " …" : ""}
        </p>
      ) : null}
      {errors.length ? (
        <p className="mt-2 text-xs text-danger">오류: {errors.map((err) => String(asRecord(err).message ?? "")).join(" · ")}</p>
      ) : null}

      <div className="mt-3">
        <Collapsible title="원본 JSON" meta="raw">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted">{JSON.stringify(result, null, 2)}</pre>
        </Collapsible>
      </div>
    </div>
  );
}

function JobActionCard({
  title,
  description,
  button,
  disabled,
  running,
  tone = "brand",
  onClick,
}: {
  title: string;
  description: string;
  button: string;
  disabled: boolean;
  running: boolean;
  tone?: "brand" | "warn";
  onClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <StatusPill tone={tone}>{tone === "warn" ? "write" : "read"}</StatusPill>
      </div>
      <p className="mt-2 min-h-12 text-xs leading-5 text-muted">{description}</p>
      <button className={`btn mt-4 w-full ${tone === "warn" ? "btn-secondary" : "btn-primary"}`} disabled={disabled} aria-busy={running} onClick={onClick} type="button">
        {running ? "실행 중" : button}
      </button>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select className="input mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`btn ${active ? "btn-primary" : "btn-secondary"}`} aria-pressed={active} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function AnalysisTable({ rows }: { rows: ShipmentAnalysisRow[] }) {
  return (
    <Panel>
      <PanelHeader title="SKU 배부 분석" eyebrow="doc_analysis" meta={`${formatNumber(rows.length)} rows`} />
      <div className="overflow-auto rounded-xl border border-line">
        <table className="min-w-[118rem] divide-y divide-line text-xs">
          <thead className="bg-surface-muted text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">인보이스 번호</th>
              <th className="px-3 py-2 text-left">carrier</th>
              <th className="px-3 py-2 text-left">mode</th>
              <th className="px-3 py-2 text-left">출고일</th>
              <th className="px-3 py-2 text-left">BL</th>
              <th className="px-3 py-2 text-left">From → To</th>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-right">EA</th>
              <th className="px-3 py-2 text-right">CTN</th>
              <th className="px-3 py-2 text-right">중량비중</th>
              <th className="px-3 py-2 text-right">인보이스 총 물류비</th>
              <th className="px-3 py-2 text-right">인보이스 총 운송비</th>
              <th className="px-3 py-2 text-right">인보이스 총 관세</th>
              <th className="px-3 py-2 text-right">인보이스 총 기타비</th>
              <th className="px-3 py-2 text-right">SKU 물류비 배분</th>
              <th className="px-3 py-2 text-right">SKU 물류비 단가</th>
              <th className="px-3 py-2 text-right">SKU 운송비 단가</th>
              <th className="px-3 py-2 text-right">SKU 관세 단가</th>
              <th className="px-3 py-2 text-right">SKU 기타비 단가</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface">
            {rows.length === 0 ? (
              <tr><td colSpan={20} className="px-3 py-8 text-center text-faint">표시할 데이터가 없습니다.</td></tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.sourceLineId} className="hover:bg-surface-muted/60">
                <td className="px-3 py-2"><StatusPill tone={row.analysisStatus === "analyzed" ? "ok" : "neutral"}>{row.analysisStatus === "analyzed" ? "분석완료" : "미분석"}</StatusPill></td>
                <td className="px-3 py-2 font-medium tabular-nums">{row.invoiceNo}</td>
                <td className="px-3 py-2">{row.carrier}</td>
                <td className="px-3 py-2"><StatusPill tone={modeTone(row.carrierMode)}>{row.carrierMode || "-"}</StatusPill></td>
                <td className="px-3 py-2 tabular-nums text-faint">{row.shipDate || "-"}</td>
                <td className="px-3 py-2 tabular-nums text-brand-ink">{row.blNo || "-"}</td>
                <td className="px-3 py-2 text-faint">{row.fromWarehouse || "-"} → {row.toWarehouse || "-"}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-ink">{row.resourceCode}</div>
                  <div className="max-w-[18rem] truncate text-xs text-faint">{row.resourceName}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.qtyEa)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.qtyCtn)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.analysisStatus === "analyzed" ? `${formatUnit(row.weightRatioPct)}%` : "-"}</td>
                <CostCell value={row.invoiceTotalLogisticsKrw} analyzed={row.analysisStatus === "analyzed"} />
                <CostCell value={row.invoiceTotalFreightKrw} analyzed={row.analysisStatus === "analyzed"} />
                <CostCell value={row.invoiceTotalDutyKrw} analyzed={row.analysisStatus === "analyzed"} />
                <CostCell value={row.invoiceTotalOtherKrw} analyzed={row.analysisStatus === "analyzed"} />
                <CostCell value={row.skuLogisticsAllocKrw} analyzed={row.analysisStatus === "analyzed"} strong />
                <UnitCell value={row.skuLogisticsUnitKrw} analyzed={row.analysisStatus === "analyzed"} strong />
                <UnitCell value={row.skuFreightUnitKrw} analyzed={row.analysisStatus === "analyzed"} />
                <UnitCell value={row.skuDutyUnitKrw} analyzed={row.analysisStatus === "analyzed"} />
                <UnitCell value={row.skuOtherUnitKrw} analyzed={row.analysisStatus === "analyzed"} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function OceanSourceTable({ rows }: { rows: OceanSettlementLineRow[] }) {
  return (
    <Panel>
      <PanelHeader title="해상_정산 원천" eyebrow="stg_settlement_ocean_lines" meta={`${formatNumber(rows.length)} rows`} />
      <div className="overflow-auto rounded-xl border border-line">
        <table className="min-w-[76rem] divide-y divide-line text-xs">
          <thead className="bg-surface-muted text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left">invoice_date</th>
              <th className="px-3 py-2 text-left">BL</th>
              <th className="px-3 py-2 text-left">country</th>
              <th className="px-3 py-2 text-left">charge_type</th>
              <th className="px-3 py-2 text-left">currency</th>
              <th className="px-3 py-2 text-right">amount_orig</th>
              <th className="px-3 py-2 text-right">amount_krw</th>
              <th className="px-3 py-2 text-right">tax</th>
              <th className="px-3 py-2 text-left">container</th>
              <th className="px-3 py-2 text-left">file</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface">
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-faint">표시할 데이터가 없습니다.</td></tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.rawKey} className="hover:bg-surface-muted/60">
                <td className="px-3 py-2 tabular-nums text-faint">{row.invoiceDate || "-"}</td>
                <td className="px-3 py-2 tabular-nums text-brand-ink">{row.blNo}</td>
                <td className="px-3 py-2">{row.country}</td>
                <td className="px-3 py-2"><StatusPill tone={row.chargeType === "DUTY" ? "warn" : row.chargeType === "OCEAN" ? "brand" : "neutral"}>{row.chargeType}</StatusPill></td>
                <td className="px-3 py-2">{row.currency}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.amountOrig)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(row.amountKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(row.taxKrw)}</td>
                <td className="px-3 py-2"><StatusPill>{row.containerType || "미지정"}</StatusPill></td>
                <td className="px-3 py-2 max-w-[18rem] truncate text-faint">{row.fileName || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MonthlyTable({ rows }: { rows: MonthlySkuCostRow[] }) {
  return (
    <Panel>
      <PanelHeader title="월별 SKU 단가" eyebrow="mart_logistics_monthly_sku_cost" meta={`${formatNumber(rows.length)} rows`} />
      <div className="overflow-auto rounded-xl border border-line">
        <table className="min-w-[82rem] divide-y divide-line text-xs">
          <thead className="bg-surface-muted text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left">월</th>
              <th className="px-3 py-2 text-left">mode</th>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-right">EA</th>
              <th className="px-3 py-2 text-right">BL</th>
              <th className="px-3 py-2 text-right">Invoice</th>
              <th className="px-3 py-2 text-right">월 총 물류비</th>
              <th className="px-3 py-2 text-right">SKU 배부액</th>
              <th className="px-3 py-2 text-right">총/EA</th>
              <th className="px-3 py-2 text-right">운송/EA</th>
              <th className="px-3 py-2 text-right">관세/EA</th>
              <th className="px-3 py-2 text-right">기타/EA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface">
            {rows.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-faint">표시할 데이터가 없습니다.</td></tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.rawKey} className="hover:bg-surface-muted/60">
                <td className="px-3 py-2 tabular-nums text-faint">{row.month}</td>
                <td className="px-3 py-2"><StatusPill tone={modeTone(row.carrierMode)}>{row.carrierMode}</StatusPill></td>
                <td className="px-3 py-2">
                  <div className="font-medium text-ink">{row.resourceCode}</div>
                  <div className="max-w-[18rem] truncate text-xs text-faint">{row.resourceName}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.qtyEa)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.blCount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.invoiceCount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(row.monthlyTotalLogisticsKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatKrw(row.skuLogisticsAllocKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatUnit(row.skuLogisticsUnitKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuFreightUnitKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuDutyUnitKrw)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuOtherUnitKrw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CostCell({ value, analyzed, strong = false }: { value: number; analyzed: boolean; strong?: boolean }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{analyzed ? formatKrw(value) : "-"}</td>;
}

function UnitCell({ value, analyzed, strong = false }: { value: number; analyzed: boolean; strong?: boolean }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{analyzed ? formatUnit(value) : "-"}</td>;
}

function modeTone(mode: string) {
  if (mode === "해상") return "brand" as const;
  if (mode === "SEND") return "ok" as const;
  if (mode === "택배" || mode === "그라운드") return "warn" as const;
  return "neutral" as const;
}
