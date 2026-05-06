import type { KpiSummary } from "@/lib/scm-dashboard/types";

const kpiLabels: Array<[keyof KpiSummary, string]> = [
  ["totalInventory", "Total inventory"],
  ["centerCount", "Selected centers"],
  ["skuCount", "Selected SKUs"],
  ["inboundQty", "Inbound/WIP qty"],
  ["shortageSkuCount", "Risk SKUs"],
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function ScmKpiCards({ kpis }: { kpis: KpiSummary }) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {kpiLabels.map(([key, label]) => (
        <article
          className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
          key={key}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">
            {formatNumber(kpis[key])}
          </p>
        </article>
      ))}
    </section>
  );
}
