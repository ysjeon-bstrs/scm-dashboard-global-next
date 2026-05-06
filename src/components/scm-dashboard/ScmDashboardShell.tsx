import type { ReactNode } from "react";

import type { UserSummary } from "@/lib/scm-dashboard/types";

interface ScmDashboardShellProps {
  children: ReactNode;
  user: UserSummary;
  onSignOut: () => void;
}

export function ScmDashboardShell({
  children,
  user,
  onSignOut,
}: ScmDashboardShellProps) {
  return (
    <main className="min-h-dvh px-3 py-4 sm:px-5 sm:py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">Global prototype</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              글로벌 SCM Dashboard
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Vercel 개인 배포에서 인증, Supabase 읽기, 대시보드 계산, Excel
              allocation 흐름을 검증합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            <span className="max-w-full truncate px-2 text-sm text-slate-600">
              {user.email}
            </span>
            <button
              className="min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={onSignOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
