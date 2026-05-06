"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ScmDashboardShell } from "@/components/scm-dashboard/ScmDashboardShell";
import { ScmExcelUploadPanel } from "@/components/scm-dashboard/ScmExcelUploadPanel";
import { ScmFilters } from "@/components/scm-dashboard/ScmFilters";
import { ScmInventoryGrid } from "@/components/scm-dashboard/ScmInventoryGrid";
import { ScmKpiCards } from "@/components/scm-dashboard/ScmKpiCards";
import { ScmTimelineChart } from "@/components/scm-dashboard/ScmTimelineChart";
import { SCM_DASHBOARD_API_PATH } from "@/lib/scm-dashboard/constants";
import { createBrowserSupabaseClient } from "@/lib/scm-dashboard/supabaseBrowser";
import type {
  DashboardData,
  DashboardFilters,
  UserSummary,
} from "@/lib/scm-dashboard/types";

const emptyDashboardData: DashboardData = {
  inventory: [],
  moves: [],
  centerOptions: [],
  skuOptions: [],
  kpis: {
    totalInventory: 0,
    centerCount: 0,
    skuCount: 0,
    inboundQty: 0,
    wipQty: 0,
    shortageSkuCount: 0,
  },
  timeline: [],
  notices: [],
};

const initialFilters: DashboardFilters = {
  centers: [],
  skus: [],
  dateFrom: null,
  dateTo: null,
  useTrendForecast: false,
  lookbackDays: 30,
};

interface ScmDashboardClientProps {
  user: UserSummary | null;
  initialAuthError: "unauthenticated" | "forbidden-domain" | null;
}

function buildDashboardUrl(filters: DashboardFilters) {
  const params = new URLSearchParams();

  filters.centers.forEach((center) => params.append("center", center));
  filters.skus.forEach((sku) => params.append("sku", sku));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.useTrendForecast) params.set("trend", "true");
  params.set("lookbackDays", String(filters.lookbackDays));

  const query = params.toString();
  return query ? `${SCM_DASHBOARD_API_PATH}?${query}` : SCM_DASHBOARD_API_PATH;
}

export default function ScmDashboardClient({
  user,
  initialAuthError,
}: ScmDashboardClientProps) {
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const authMessage = useMemo(() => {
    if (initialAuthError === "forbidden-domain") {
      return "boosters.kr Google account is required.";
    }

    if (initialAuthError === "unauthenticated") {
      return "Sign in with your boosters.kr Google account.";
    }

    return null;
  }, [initialAuthError]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    const response = await fetch(buildDashboardUrl(filters), {
      cache: "no-store",
    });

    if (!response.ok) {
      setError(`Dashboard API failed with ${response.status}.`);
      setIsLoading(false);
      return;
    }

    setData((await response.json()) as DashboardData);
    setIsLoading(false);
  }, [filters, user]);

  useEffect(() => {
    // Dashboard data is synchronized with protected API state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard();
  }, [loadDashboard]);

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
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-emerald-700">Protected dashboard</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            글로벌 SCM Dashboard
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{authMessage}</p>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button
            className="mt-6 min-h-9 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            onClick={signInWithGoogle}
            type="button"
          >
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <ScmDashboardShell onSignOut={signOut} user={user}>
      {data.notices.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.notices.join(" ")}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <ScmFilters
        centerOptions={data.centerOptions}
        filters={filters}
        onChange={setFilters}
        skuOptions={data.skuOptions}
      />
      <ScmKpiCards kpis={data.kpis} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ScmInventoryGrid rows={data.inventory} />
        <div className="flex min-w-0 flex-col gap-4">
          <ScmTimelineChart points={data.timeline} />
          <ScmExcelUploadPanel />
        </div>
      </div>
      {isLoading ? (
        <div className="fixed bottom-4 right-4 rounded-md bg-slate-950 px-3 py-2 text-sm text-white shadow-lg">
          Loading dashboard
        </div>
      ) : null}
    </ScmDashboardShell>
  );
}
