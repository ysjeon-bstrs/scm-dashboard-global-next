import type { TimelinePoint } from "@/lib/scm-dashboard/types";
import { Panel, PanelHeader } from "@/components/scm-dashboard/ui";

function maxPoint(points: TimelinePoint[]) {
  return Math.max(
    1,
    ...points.map((point) =>
      Math.max(point.stockQty, point.inboundQty, point.forecastQty ?? 0),
    ),
  );
}

function LegendDot({ label, swatch }: { label: string; swatch: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}

export function ScmTimelineChart({ points }: { points: TimelinePoint[] }) {
  const max = maxPoint(points);
  const visiblePoints = points.slice(-14);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Trend"
        meta={`Latest ${visiblePoints.length} dates`}
        title="Inventory timeline"
      />
      {visiblePoints.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-sunken/60 px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">No timeline data yet</p>
          <p className="mt-1 text-xs text-faint">
            Connect Supabase tables to render daily stock and inbound movement.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4">
            <LegendDot label="Stock" swatch="bg-brand" />
            <LegendDot label="Inbound" swatch="bg-info" />
          </div>
          <div className="grid gap-2.5">
            {visiblePoints.map((point) => (
              <div
                className="grid grid-cols-[76px_1fr] items-center gap-3"
                key={point.date}
              >
                <span className="text-xs tabular-nums text-faint">{point.date}</span>
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{
                        width: `${Math.max(2, (point.stockQty / max) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-info"
                      style={{
                        width: `${Math.max(2, (point.inboundQty / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
