import type { ReactNode } from "react";

import type { UserSummary } from "@/lib/scm-dashboard/types";
import { PageHeader } from "@/components/scm-dashboard/ui";

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
    <main className="min-h-dvh px-4 py-6 sm:px-6 lg:px-8">
      <div className="stagger mx-auto flex w-full max-w-7xl flex-col gap-5">
        <PageHeader
          actions={
            <>
              <span className="max-w-[14rem] truncate px-1 text-sm text-muted">
                {user.email}
              </span>
              <button
                className="btn btn-secondary"
                onClick={onSignOut}
                type="button"
              >
                Sign out
              </button>
            </>
          }
          description="Vercel 개인 배포에서 인증, Supabase 읽기, 대시보드 계산, Excel allocation 흐름을 검증합니다."
          eyebrow="Global prototype"
          title="글로벌 SCM Dashboard"
        />
        {children}
      </div>
    </main>
  );
}
