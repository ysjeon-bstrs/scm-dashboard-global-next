import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { fetchAmazonStockSummary } from "@/lib/scm-dashboard/amazonStockQueries";
import { fetchAcrossbSummary } from "@/lib/scm-dashboard/acrossbQueries";
import { fetchCjStockOverview } from "@/lib/scm-dashboard/cjQueries";
import { fetchDomesticStockSummary } from "@/lib/scm-dashboard/domesticStockQueries";

export async function GET() {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const notices: string[] = [];

  const domestic = await fetchDomesticStockSummary().catch((error: unknown) => {
    notices.push(
      `디자인KR summary를 불러오지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  });

  // SQL aggregate over the full latest snapshot — a row-limited fetch here
  // used to cap KPI sums at the first 5,000 lot rows.
  const cj = await fetchCjStockOverview().catch((error: unknown) => {
    notices.push(
      `CJ LOT 재고를 불러오지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  });

  const amazon = await fetchAmazonStockSummary().catch((error: unknown) => {
    notices.push(
      `Amazon FBA 재고를 불러오지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  });

  const acrossb = await fetchAcrossbSummary().catch((error: unknown) => {
    notices.push(
      `AcrossB 재고를 불러오지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  });

  return NextResponse.json({
    meta: {
      generated_at: new Date().toISOString(),
    },
    notices,
    warehouses: [
      {
        id: "designkr",
        label: "디자인KR",
        description: "CJUS 보충 창고 역할의 국내 디자인로지스 재고입니다. 운영재고는 DL_입고만 포함합니다.",
        href: "/global/domestic-stock",
        status: domestic ? "active" : "unavailable",
        status_label: domestic ? "적재 완료" : "확인 필요",
        snapshot_date: domestic?.meta.snapshot_date ?? null,
        primary_metric_label: "운영재고",
        primary_metric_value: domestic?.totals.stock_running ?? 0,
        secondary_metrics: [
          { label: "SKU", value: domestic?.meta.sku_count ?? 0 },
          { label: "제외재고", value: domestic?.totals.stock_excluded ?? 0 },
          { label: "LOT", value: domestic?.totals.lot_count ?? 0 },
        ],
        tone: "ok",
      },
      {
        id: "cj",
        label: "CJ 서부US",
        description: "미국 출고 창고입니다. 현재는 기존 CJ 첫 탭 중 재고 확인과 LOT 배정 기능을 이식했습니다.",
        href: "/global/scm-dashboard/cj-allocation",
        status: cj ? "active" : "unavailable",
        status_label: cj ? "작업 가능" : "확인 필요",
        snapshot_date: cj?.close_date ?? null,
        primary_metric_label: "가용재고",
        primary_metric_value: cj?.available_qty ?? 0,
        secondary_metrics: [
          { label: "SKU", value: cj?.sku_count ?? 0 },
          { label: "Depot", value: cj?.depot_count ?? 0 },
          { label: "1년내 만료 LOT", value: cj?.expiry_risk_count ?? 0 },
        ],
        tone: (cj?.expiry_risk_count ?? 0) > 0 ? "warn" : "brand",
      },
      {
        id: "amazon",
        label: "Amazon FBA",
        description: "기존 amz_stock mart를 먼저 연결한 Amazon FBA 재고 workbench입니다. DOH와 Action Center는 다음 migration 단계입니다.",
        href: "/global/amazon",
        status: amazon ? "active" : "unavailable",
        status_label: amazon ? "재고 연결" : "확인 필요",
        snapshot_date: amazon?.meta.latest_date ?? null,
        primary_metric_label: "Sellable",
        primary_metric_value: amazon?.totals.stock_sellable ?? null,
        secondary_metrics: [
          { label: "SKU", value: amazon?.meta.sku_count ?? null },
          { label: "Incoming", value: amazon?.totals.stock_incoming ?? null },
          { label: "Center", value: amazon?.meta.center_count ?? null },
        ],
        tone: amazon ? "brand" : "neutral",
      },
      {
        id: "acrossb",
        label: "AcrossB NL/UK",
        description: "AcrossB Open API 원천 테이블을 read-only로 조회하는 NL/UK WMS 재고와 입고 요청 화면입니다. US 창고는 현재 운영 범위에서 제외합니다.",
        href: "/global/acrossb",
        status: acrossb ? "active" : "unavailable",
        status_label: acrossb ? "재고 연결" : "확인 필요",
        snapshot_date: acrossb?.meta.latest_inventory_updated_at?.slice(0, 10) ?? null,
        primary_metric_label: "Available",
        primary_metric_value: acrossb?.totals.available_qty ?? null,
        secondary_metrics: [
          { label: "SKU", value: acrossb?.meta.sku_count ?? null },
          { label: "LOT", value: acrossb?.meta.lot_count ?? null },
          { label: "Inbound", value: acrossb?.meta.inbound_request_count ?? null },
        ],
        tone: acrossb ? "ok" : "neutral",
      },
      {
        id: "ocean-settlement",
        label: "해상 정산",
        description: "boosters_scm 이동 로그와 Supabase 정산 mart를 연결하는 Ocean MVP 페이지입니다. 해상 parity 이후 SEND/그라운드/Unit Economics로 확장합니다.",
        href: "/global/logistics-settlement",
        status: "active",
        status_label: "MVP 구현중",
        snapshot_date: null,
        primary_metric_label: "mode",
        primary_metric_value: null,
        secondary_metrics: [
          { label: "Source", value: "boosters_scm" },
          { label: "Mart", value: "Supabase" },
          { label: "Scope", value: "해상" },
        ],
        tone: "brand",
      },
    ],
  });
}
