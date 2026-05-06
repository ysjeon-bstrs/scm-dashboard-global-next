import type { TimelinePoint } from "@/lib/scm-dashboard/types";

function maxPoint(points: TimelinePoint[]) {
  return Math.max(
    1,
    ...points.map((point) =>
      Math.max(point.stockQty, point.inboundQty, point.forecastQty ?? 0),
    ),
  );
}

export function ScmTimelineChart({ points }: { points: TimelinePoint[] }) {
  const max = maxPoint(points);
  const visiblePoints = points.slice(-14);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Inventory timeline</h2>
        <p className="text-xs text-slate-500">Latest {visiblePoints.length} dates</p>
      </div>
      <div className="mt-4 grid gap-2">
        {visiblePoints.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">
            Connect Supabase tables to render the timeline.
          </p>
        ) : (
          visiblePoints.map((point) => (
            <div className="grid grid-cols-[88px_1fr] items-center gap-3" key={point.date}>
              <span className="text-xs tabular-nums text-slate-500">{point.date}</span>
              <div className="space-y-1">
                <div className="h-2 rounded bg-slate-100">
                  <div
                    className="h-2 rounded bg-emerald-600"
                    style={{ width: `${Math.max(2, (point.stockQty / max) * 100)}%` }}
                  />
                </div>
                <div className="h-1.5 rounded bg-slate-100">
                  <div
                    className="h-1.5 rounded bg-sky-500"
                    style={{ width: `${Math.max(2, (point.inboundQty / max) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
