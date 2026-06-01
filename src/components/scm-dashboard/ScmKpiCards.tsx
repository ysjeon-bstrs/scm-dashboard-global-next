import type { KpiSummary } from "@/lib/scm-dashboard/types";
import { Panel, Stat } from "@/components/scm-dashboard/ui";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

const SECONDARY: Array<[keyof KpiSummary, string]> = [
  ["centerCount", "Selected centers"],
  ["skuCount", "Selected SKUs"],
  ["inboundQty", "Inbound / WIP qty"],
];

export function ScmKpiCards({ kpis }: { kpis: KpiSummary }) {
  const hasRisk = kpis.shortageSkuCount > 0;

  return (
    <Panel>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_3fr] lg:gap-9">
        <div className="lg:border-r lg:border-line lg:pr-9">
          <p className="eyebrow">Inventory on hand</p>
          <p className="mt-3 text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums text-ink">
            {formatNumber(kpis.totalInventory)}
          </p>
          <p className="mt-2 text-xs text-faint">Total available EA across selection</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {SECONDARY.map(([key, label]) => (
            <Stat key={key} label={label} value={formatNumber(kpis[key])} />
          ))}
          <Stat
            hint={hasRisk ? "Below safety threshold" : "All within range"}
            label="Risk SKUs"
            tone={hasRisk ? "danger" : "ok"}
            value={formatNumber(kpis.shortageSkuCount)}
          />
        </div>
      </div>
    </Panel>
  );
}
