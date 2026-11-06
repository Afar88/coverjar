"use client";

import { useMemo } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { LedgerEntry } from "./types";
import { fmt } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

type LedgerRow = {
  id: number;
  date: string;
  person: string;
  activity: string;
  bucket: string;
  amount: number;
};

export function LedgerGrid({
  entries,
  names,
  showPerson = true,
}: {
  entries: LedgerEntry[];
  names: Record<string, string>;
  showPerson?: boolean;
}) {
  const rowData = useMemo<LedgerRow[]>(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        date: entry.created_at.slice(0, 10),
        person: names[entry.member_id] || "Family member",
        activity: entry.memo + (entry.paypal_ref && entry.paypal_ref !== "SEED" ? ` · ${entry.paypal_ref}` : ""),
        bucket: entry.bucket === "jar" ? "Umbrella fund" : "Spending",
        amount: entry.amount_cents,
      })),
    [entries, names],
  );

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "date", headerName: "Date", minWidth: 112, maxWidth: 130 },
      ...(showPerson
        ? [{ field: "person", headerName: "Family member", minWidth: 135 } as ColDef<LedgerRow>]
        : []),
      { field: "activity", headerName: "Activity", minWidth: 190, flex: 2, tooltipField: "activity" },
      { field: "bucket", headerName: "Bucket", minWidth: 125, maxWidth: 150 },
      {
        field: "amount",
        headerName: "Amount",
        minWidth: 125,
        maxWidth: 145,
        type: "rightAligned",
        valueFormatter: (params) => fmt(Number(params.value ?? 0)),
        cellClassRules: {
          "text-emerald-700 font-semibold": (params) => Number(params.value) >= 0,
          "text-rose-700 font-semibold": (params) => Number(params.value) < 0,
        },
      },
    ],
    [showPerson],
  );

  const defaultColDef = useMemo<ColDef<LedgerRow>>(
    () => ({ sortable: true, resizable: true, filter: true }),
    [],
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">Search, sort and filter family activity</p>
        <span className="text-xs font-medium text-slate-500">{entries.length} records</span>
      </div>
      <div style={{ height: 340, width: "100%" }}>
        <AgGridReact<LedgerRow>
          theme={themeQuartz}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => String(params.data.id)}
          pagination
          paginationPageSize={8}
          paginationPageSizeSelector={false}
          suppressCellFocus
          animateRows
          overlayNoRowsTemplate='<span class="text-sm text-slate-500">No activity yet.</span>'
        />
      </div>
    </div>
  );
}
