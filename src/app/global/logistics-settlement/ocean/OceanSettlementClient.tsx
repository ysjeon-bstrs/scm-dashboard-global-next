"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
  StatusPill,
} from "@/components/scm-dashboard/ui";
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

function formatUnit(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export default function OceanSettlementClient({
  user,
  initialAuthError,
}: OceanSettlementClientProps) {
  const [summary, setSummary] = useState<OceanSettlementSummary>(emptySummary);
  const [month, setMonth] = useState("");
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
      const params = new URLSearchParams({ limit: "1000" });
      if (month) params.set("month", month);
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
  }, [authMessage, month]);

  useEffect(() => {
    // Initial data is loaded from authenticated API routes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return summary.rows;
    return summary.rows.filter((row) =>
      [row.blNo, row.invoiceNo, row.resourceCode, row.resourceName, row.containerType]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, summary.rows]);

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
          <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
            <label className="block">
              <span className="field-label">정산월</span>
              <input
                className="input mt-1 w-full"
                placeholder="YYYY-MM"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="field-label">검색</span>
              <input
                className="input mt-1 w-full"
                placeholder="BL / invoice / SKU / 상품명 / container"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="text-xs text-faint">
              {user ? `${user.email} · ` : ""}
              {summary.meta.generatedAt ? `generated ${summary.meta.generatedAt.slice(0, 19)}` : "mart 대기"}
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-5">
          <Panel><Stat label="BL" value={formatNumber(summary.meta.blCount)} hint={`${formatNumber(summary.meta.invoiceCount)} invoices`} /></Panel>
          <Panel><Stat label="수량" value={formatNumber(summary.totals.qtyEa)} hint={`${formatNumber(summary.totals.qtyCtn)} ctn`} /></Panel>
          <Panel><Stat label="운송비" value={formatKrw(summary.totals.freightKrw)} tone="brand" /></Panel>
          <Panel><Stat label="관세" value={formatKrw(summary.totals.dutyKrw)} tone="warn" /></Panel>
          <Panel><Stat label="총 물류비" value={formatKrw(summary.totals.logisticsKrw)} tone="ok" hint={`기타 ${formatKrw(summary.totals.otherKrw)}`} /></Panel>
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
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-right">EA</th>
                  <th className="px-3 py-2 text-right">운송/EA</th>
                  <th className="px-3 py-2 text-right">관세/EA</th>
                  <th className="px-3 py-2 text-right">기타/EA</th>
                  <th className="px-3 py-2 text-right">총/EA</th>
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
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{row.resourceCode}</div>
                      <div className="max-w-[18rem] truncate text-xs text-faint">{row.resourceName}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.qtyEa)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuFreightUnitKrw)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuDutyUnitKrw)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnit(row.skuOtherUnitKrw)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatUnit(row.skuLogisticsUnitKrw)}</td>
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
