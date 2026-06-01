"use client";

import type { DashboardFilters } from "@/lib/scm-dashboard/types";
import { Panel } from "@/components/scm-dashboard/ui";

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
    <Panel>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1">
          <span className="field-label">Center</span>
          <select
            className="field mt-1.5 min-h-28 py-2"
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
        <label className="min-w-0 flex-1">
          <span className="field-label">SKU</span>
          <select
            className="field mt-1.5 min-h-28 py-2"
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
          <label>
            <span className="field-label">From</span>
            <input
              className="field mt-1.5"
              onChange={(event) =>
                onChange({ ...filters, dateFrom: event.currentTarget.value || null })
              }
              type="date"
              value={filters.dateFrom ?? ""}
            />
          </label>
          <label>
            <span className="field-label">To</span>
            <input
              className="field mt-1.5"
              onChange={(event) =>
                onChange({ ...filters, dateTo: event.currentTarget.value || null })
              }
              type="date"
              value={filters.dateTo ?? ""}
            />
          </label>
          <label className="flex min-h-9 items-center gap-2 self-end text-sm font-medium text-ink">
            <input
              checked={filters.useTrendForecast}
              className="h-4 w-4 accent-brand"
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
          <label>
            <span className="field-label">Lookback days</span>
            <input
              className="field mt-1.5 tabular-nums"
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
    </Panel>
  );
}
