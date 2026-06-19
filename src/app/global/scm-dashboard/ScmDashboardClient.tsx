"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, BrandMark, PageHeader, Panel, PanelHeader, StatusPill } from "@/components/scm-dashboard/ui";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type { UserSummary } from "@/lib/scm-dashboard/types";

interface ScmDashboardClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

type HubTone = "neutral" | "brand" | "ok" | "warn" | "danger";

type Metric = {
  label: string;
  value: number | null;
};

type WarehouseCard = {
  id: string;
  label: string;
  description: string;
  href: string | null;
  status: "active" | "planned" | "unavailable";
  status_label: string;
  snapshot_date: string | null;
  primary_metric_label: string;
  primary_metric_value: number | null;
  secondary_metrics: Metric[];
  tone: HubTone;
};

type OverviewPayload = {
  meta: {
    generated_at: string;
  };
  notices: string[];
  warehouses: WarehouseCard[];
};

const emptyOverview: OverviewPayload = {
  meta: { generated_at: "" },
  notices: [],
  warehouses: [],
};

const toneText: Record<HubTone, string> = {
  neutral: "text-muted",
  brand: "text-brand-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("ko-KR");
}

function formatDate(value: string | null | undefined) {
  return value || "-";
}

function statusTone(status: WarehouseCard["status"], tone: HubTone) {
  if (status === "planned") return "neutral" as const;
  if (status === "unavailable") return "danger" as const;
  if (tone === "warn") return "warn" as const;
  if (tone === "ok") return "ok" as const;
  return "brand" as const;
}

function summaryTotal(warehouses: WarehouseCard[], id: string, key: "primary_metric_value") {
  return warehouses.find((warehouse) => warehouse.id === id)?.[key] ?? null;
}

function findMetric(warehouses: WarehouseCard[], id: string, label: string) {
  return warehouses
    .find((warehouse) => warehouse.id === id)
    ?.secondary_metrics.find((metric) => metric.label === label)?.value ?? null;
}

export default function ScmDashboardClient({
  user,
  initialAuthError,
}: ScmDashboardClientProps) {
  const [overview, setOverview] = useState<OverviewPayload>(emptyOverview);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") {
      return "boosters.kr Google 계정만 접근할 수 있습니다.";
    }

    if (initialAuthError === "unauthenticated") {
      return "SCM 대시보드를 보려면 boosters.kr Google 계정으로 로그인하세요.";
    }

    return null;
  }, [initialAuthError]);

  const loadOverview = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    const response = await fetch("/api/scm-dashboard/overview", {
      cache: "no-store",
    });

    if (!response.ok) {
      setError(`Overview API failed with ${response.status}.`);
      setIsLoading(false);
      return;
    }

    setOverview((await response.json()) as OverviewPayload);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // Hub data is synchronized with protected API state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOverview();
  }, [loadOverview]);

  async function signInWithGoogle() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/global/scm-dashboard`,
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

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="panel w-full max-w-lg p-7 sm:p-9">
          <BrandMark className="h-10 w-10" />
          <p className="eyebrow mt-5">Protected dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            글로벌 SCM Dashboard
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

  const designStock = summaryTotal(overview.warehouses, "designkr", "primary_metric_value");
  const cjStock = summaryTotal(overview.warehouses, "cj", "primary_metric_value");
  const designSku = findMetric(overview.warehouses, "designkr", "SKU");
  const cjSku = findMetric(overview.warehouses, "cj", "SKU");

  return (
    <main className="min-h-dvh px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4">
        <PageHeader
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => void loadOverview()} type="button">
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
          description="Vercel 검증 화면입니다. 기존 파이썬 대시보드의 재고 홈, 센터별 재고, 발주 허브 구조를 이어받아 창고별 상세 페이지를 연결합니다."
          eyebrow="SCM hub"
          title="글로벌 SCM Dashboard"
        />

        {overview.notices.map((notice) => (
          <Banner key={notice} tone="warn">
            {notice}
          </Banner>
        ))}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Panel className="p-0">
          <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="brand">메인 KPI 허브</StatusPill>
                <StatusPill tone="ok">디자인KR 연결</StatusPill>
                <StatusPill tone="warn">CJ 작업 페이지 연결</StatusPill>
                <StatusPill tone="neutral">Amazon 준비중</StatusPill>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                기존 파이썬 대시보드의 창고 메뉴 구조를 Vercel에 맞춰 다시 잡았습니다. 디자인KR은
                CJUS 보충 창고, CJUS는 출고와 LOT 배정 창고, Amazon은 판매와 DOH 판단 창고로 봅니다.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
              <HubMetric label="디자인KR 운영재고" tone="ok" value={designStock} />
              <HubMetric label="디자인KR SKU" value={designSku} />
              <HubMetric label="CJ 가용재고 조회분" tone="warn" value={cjStock} />
              <HubMetric label="CJ SKU" value={cjSku} />
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="공급망 연결" meta="파이썬 대시보드의 재고 홈 / 공급망 매트릭스 기준" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
            <SupplyNode
              caption="입고 예정"
              detail="생산, 이동, 도착 예정 수량"
              label="생산(WIP)"
              tone="neutral"
            />
            <SupplyArrow label="생산→입고" />
            <SupplyNode
              caption="보충 창고"
              detail="DL_입고 기준 운영재고, 임시/대기 bucket 분리"
              href="/global/domestic-stock"
              label="디자인KR"
              tone="ok"
              value={designStock}
            />
            <SupplyArrow label="태광→CJ" />
            <SupplyNode
              caption="출고 창고"
              detail="CJ 재고 확인, LOT 배정, 향후 재고일수 탭"
              href="/global/scm-dashboard/cj-allocation"
              label="CJ 서부US"
              tone="warn"
              value={cjStock}
            />
            <SupplyArrow label="CJ→AMZ" />
            <SupplyNode
              caption="판매 채널"
              detail="FBA 재고, 판매속도, DOH, 액션센터 migration 예정"
              label="Amazon FBA"
              tone="brand"
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="이전 대시보드 메뉴 반영안" meta="지금 구현된 것과 다음 이식 대상" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <MenuMapCard
              items={[
                "SKU, 센터 선택 후 생산중, 디자인KR, CJ서부US, AMZUS를 한 줄에서 비교",
                "입고 예정 현황을 아래에 두고 이동 경로와 예상 도착일 확인",
                "Vercel에서는 메인 허브와 공급망 연결 섹션으로 먼저 반영",
              ]}
              title="재고 홈"
            />
            <MenuMapCard
              items={[
                "디자인KR: DOH 현황, 출고 현황, 입고 예정, 가상창고 배분",
                "CJ: 재고·출고, 입고현황, 액션 센터",
                "현재는 디자인KR 재고 상세와 CJ 액션 센터가 구현됨",
              ]}
              title="센터별 재고"
            />
            <MenuMapCard
              items={[
                "Amazon US/Non-US 탭, 대시보드와 액션 센터 분리",
                "회사 DB부터 Supabase까지 이어진 기존 ETL 맥락이 가장 안정적",
                "다음 단계에서 Amazon FBA/판매/DOH mart를 Vercel 카드에 연결",
              ]}
              title="Amazon"
            />
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Panel>
            <PanelHeader
              meta={overview.meta.generated_at ? `갱신 ${new Date(overview.meta.generated_at).toLocaleString("ko-KR")}` : "대기"}
              title="창고별 작업 메뉴"
            />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {overview.warehouses.map((warehouse) => (
                <WarehouseCardView key={warehouse.id} warehouse={warehouse} />
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="현재 연결 구조" />
            <ol className="space-y-3 text-sm leading-6 text-muted">
              <FlowStep
                label="메인"
                text="/global/scm-dashboard에서 창고별 상태와 다음 작업을 선택합니다."
              />
              <FlowStep
                label="디자인KR"
                text="Supabase domestic mart의 SKU 요약과 LOT 상세를 확인합니다."
              />
              <FlowStep
                label="CJ"
                text="CJ LOT 재고를 기반으로 OMS 출고 요청을 FEFO 방식으로 배정합니다."
              />
              <FlowStep
                label="Amazon"
                text="Amazon FBA 재고, 판매, DOH mart를 연결할 다음 대상입니다."
              />
            </ol>
          </Panel>
        </div>

        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-xs">
              <thead className="bg-sunken text-[11px] font-semibold text-slate-structure">
                <tr className="border-b border-line-strong">
                  <th className="px-3 py-2">영역</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">스냅샷</th>
                  <th className="px-3 py-2 text-right">대표 수량</th>
                  <th className="px-3 py-2">다음 액션</th>
                </tr>
              </thead>
              <tbody>
                {overview.warehouses.map((warehouse) => (
                  <tr className="border-b border-line bg-surface" key={warehouse.id}>
                    <td className="px-3 py-2 font-semibold text-ink">{warehouse.label}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={statusTone(warehouse.status, warehouse.tone)}>
                        {warehouse.status_label}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2 font-mono text-faint">
                      {formatDate(warehouse.snapshot_date)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${toneText[warehouse.tone]}`}>
                      {formatNumber(warehouse.primary_metric_value)}
                    </td>
                    <td className="px-3 py-2">
                      {warehouse.href ? (
                        <Link className="text-sm font-semibold text-brand-ink hover:underline" href={warehouse.href}>
                          상세 페이지 열기
                        </Link>
                      ) : (
                        <span className="text-muted">연결 설계 필요</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {isLoading ? (
          <div className="fixed right-4 bottom-4 flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-paper shadow-pop">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-on-brand" />
            메인 KPI 불러오는 중
          </div>
        ) : null}
      </div>
    </main>
  );
}

function HubMetric({ label, value, tone = "neutral" }: { label: string; value: number | null; tone?: HubTone }) {
  return (
    <div className="min-w-[8rem] rounded-lg border border-line bg-surface px-3 py-2">
      <p className="field-label normal-case tracking-normal">{label}</p>
      <p className={`mt-1 text-lg leading-none font-semibold tabular-nums ${toneText[tone]}`}>
        {formatNumber(value)}
      </p>
    </div>
  );
}

function SupplyNode({
  caption,
  detail,
  href,
  label,
  tone,
  value,
}: {
  caption: string;
  detail: string;
  href?: string;
  label: string;
  tone: HubTone;
  value?: number | null;
}) {
  const node = (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-4">
      <p className="field-label normal-case tracking-normal">{caption}</p>
      <h2 className={`mt-2 text-base font-semibold ${toneText[tone]}`}>{label}</h2>
      {value !== undefined ? (
        <p className="mt-3 text-2xl leading-none font-semibold tabular-nums text-ink">
          {formatNumber(value)}
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-muted">{detail}</p>
      {href ? <span className="mt-auto pt-4 text-sm font-semibold text-brand-ink">상세 보기</span> : null}
    </div>
  );

  if (!href) return node;

  return (
    <Link className="block h-full" href={href}>
      {node}
    </Link>
  );
}

function SupplyArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center text-xs font-medium text-faint lg:flex-col">
      <span className="hidden h-px w-10 bg-line lg:block" />
      <span className="rounded-full bg-sunken px-2 py-1">{label}</span>
      <span className="hidden h-px w-10 bg-line lg:block" />
    </div>
  );
}

function MenuMapCard({ items, title }: { items: string[]; title: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
        {items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-strong" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WarehouseCardView({ warehouse }: { warehouse: WarehouseCard }) {
  const content = (
    <article className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 transition duration-150 hover:border-line-strong hover:bg-sunken">
      <div className="flex items-start justify-between gap-3">
        <div>
          <StatusPill tone={statusTone(warehouse.status, warehouse.tone)}>
            {warehouse.status_label}
          </StatusPill>
          <h2 className="mt-3 text-base font-semibold text-ink">{warehouse.label}</h2>
        </div>
        <span className="font-mono text-[11px] text-faint">{formatDate(warehouse.snapshot_date)}</span>
      </div>
      <p className="mt-3 min-h-12 text-sm leading-6 text-muted">{warehouse.description}</p>
      <div className="mt-4 border-t border-line pt-4">
        <p className="field-label normal-case tracking-normal">{warehouse.primary_metric_label}</p>
        <p className={`mt-1 text-2xl leading-none font-semibold tabular-nums ${toneText[warehouse.tone]}`}>
          {formatNumber(warehouse.primary_metric_value)}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {warehouse.secondary_metrics.map((metric) => (
          <div className="rounded-lg bg-sunken px-2 py-2" key={metric.label}>
            <p className="text-faint">{metric.label}</p>
            <p className="mt-1 font-semibold tabular-nums text-ink">{formatNumber(metric.value)}</p>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-4">
        {warehouse.href ? (
          <span className="btn btn-secondary w-full">상세 페이지 열기</span>
        ) : (
          <span className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-line bg-sunken px-3 text-sm font-medium text-muted">
            연결 예정
          </span>
        )}
      </div>
    </article>
  );

  if (!warehouse.href) return content;

  return (
    <Link className="block h-full" href={warehouse.href}>
      {content}
    </Link>
  );
}

function FlowStep({ label, text }: { label: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-6 min-w-14 items-center justify-center rounded-full bg-brand-soft px-2 text-xs font-semibold text-brand-ink">
        {label}
      </span>
      <span>{text}</span>
    </li>
  );
}
