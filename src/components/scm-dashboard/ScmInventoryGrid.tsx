"use client";

import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { ModuleRegistry, type CellStyle, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useState } from "react";

import type { InventorySnapshotRow } from "@/lib/scm-dashboard/types";
import { Panel, PanelHeader } from "@/components/scm-dashboard/ui";

let modulesRegistered = false;

function registerAgGrid() {
  if (!modulesRegistered) {
    ModuleRegistry.registerModules([AllEnterpriseModule]);
    modulesRegistered = true;
  }

  const licenseKey = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY;
  if (licenseKey) {
    LicenseManager.setLicenseKey(licenseKey);
  }
}

function useGridHeight() {
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const updateHeight = () => {
      setHeight(Math.max(320, Math.min(560, window.innerHeight - 320)));
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  return height;
}

export function ScmInventoryGrid({ rows }: { rows: InventorySnapshotRow[] }) {
  const height = useGridHeight();

  useMemo(() => registerAgGrid(), []);

  const columnDefs = useMemo<ColDef<InventorySnapshotRow>[]>(
    () => [
      { field: "date", headerName: "Date", minWidth: 120 },
      { field: "snap_time", headerName: "Snapshot", minWidth: 120 },
      { field: "center", headerName: "Center", minWidth: 110 },
      { field: "resource_code", headerName: "SKU", minWidth: 150 },
      { field: "resource_name", headerName: "Name", minWidth: 220, flex: 1 },
      {
        field: "stock_qty",
        headerName: "Stock",
        minWidth: 120,
        type: "numericColumn",
        cellStyle: { textAlign: "right", fontWeight: 600 } as CellStyle,
      },
      {
        field: "available_qty",
        headerName: "Available",
        minWidth: 130,
        type: "numericColumn",
        cellStyle: { textAlign: "right", fontWeight: 600 } as CellStyle,
      },
      {
        field: "sales_qty",
        headerName: "Sales",
        minWidth: 120,
        type: "numericColumn",
        cellStyle: { textAlign: "right" } as CellStyle,
      },
    ],
    [],
  );

  return (
    <Panel>
      <PanelHeader
        eyebrow="Snapshot"
        meta={`${rows.length.toLocaleString()} rows`}
        title="Inventory table"
      />
      <div className="ag-theme-quartz w-full" style={{ height }}>
        <AgGridReact<InventorySnapshotRow>
          columnDefs={columnDefs}
          defaultColDef={{
            filter: true,
            floatingFilter: true,
            resizable: true,
            sortable: true,
          }}
          rowData={rows}
          rowSelection={{ mode: "multiRow" }}
        />
      </div>
    </Panel>
  );
}
