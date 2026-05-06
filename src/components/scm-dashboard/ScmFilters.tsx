"use client";

import type { DashboardFilters } from "@/lib/scm-dashboard/types";

interface ScmFiltersProps {
  centerOptions: string[];
  skuOptions: string[];
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}

function selectedValues(options: HTMLOptionsCollection) {
  return Array.from(options)
    .filter((option) => option.selected)
    .map((option) => option.value);
}

export function ScmFilters({
  centerOptions,
  skuOptions,
  filters,
  onChange,
}: ScmFiltersProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          Center
          <select
            className="mt-1 min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600"
            multiple
            onChange={(event) =>
              onChange({
                ...filters,
                centers: selectedValues(event.currentTarget.options),
              })
            }
            value={filters.centers}
          >
            {centerOptions.map((center) => (
              <option key={center} value={center}>
                {center}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          SKU
          <select
            className="mt-1 min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600"
            multiple
            onChange={(event) =>
              onChange({
                ...filters,
                skus: selectedValues(event.currentTarget.options),
              })
            }
            value={filters.skus}
          >
            {skuOptions.map((sku) => (
              <option key={sku} value={sku}>
                {sku}
              </option>
            ))}
          </select>
        </label>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:w-80">
          <label className="text-sm font-medium text-slate-700">
            From
            <input
              className="mt-1 min-h-9 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              onChange={(event) =>
                onChange({ ...filters, dateFrom: event.currentTarget.value || null })
              }
              type="date"
              value={filters.dateFrom ?? ""}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            To
            <input
              className="mt-1 min-h-9 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              onChange={(event) =>
                onChange({ ...filters, dateTo: event.currentTarget.value || null })
              }
              type="date"
              value={filters.dateTo ?? ""}
            />
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={filters.useTrendForecast}
              className="h-4 w-4"
              onChange={(event) =>
                onChange({
                  ...filters,
                  useTrendForecast: event.currentTarget.checked,
                })
              }
              type="checkbox"
            />
            Trend forecast
          </label>
          <label className="text-sm font-medium text-slate-700">
            Lookback days
            <input
              className="mt-1 min-h-9 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              min={1}
              onChange={(event) =>
                onChange({
                  ...filters,
                  lookbackDays: Number(event.currentTarget.value),
                })
              }
              type="number"
              value={filters.lookbackDays}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
