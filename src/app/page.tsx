import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <section className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-emerald-700">Vercel prototype</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          글로벌 SCM Dashboard
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
          Streamlit 기반 SCM Dashboard를 Next.js, Supabase, AG Grid로 이식하기
          위한 개인 검증 앱입니다.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            href="/global/scm-dashboard"
          >
            Dashboard 열기
          </Link>
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            href="/global/domestic-stock"
          >
            디자인KR 재고 열기
          </Link>
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            href="/global/logistics-settlement"
          >
            물류 정산 분석
          </Link>
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            href="/global/acrossb"
          >
            AcrossB NL/UK 재고
          </Link>
        </div>
      </section>
    </main>
  );
}
