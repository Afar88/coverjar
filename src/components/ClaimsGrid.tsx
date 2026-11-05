"use client";

import { useMemo } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { Claim } from "./types";
import { fmt } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

type ClaimRow = {
  id: number;
  submitted: string;
  teen: string;
  claim: string;
  status: string;
  requested: number;
  approved: number | null;
  assessment: string;
  confidence: string;
  reference: string;
};

const statusLabels: Record<Claim["status"], string> = {
  pending_parent: "Awaiting parent",
  payout_pending: "Payout processing",
  payout_failed: "Payout failed",
  paid: "Paid",
  denied: "Declined",
};

export function ClaimsGrid({ claims, names }: { claims: Claim[]; names: Record<string, string> }) {
  const rowData = useMemo<ClaimRow[]>(
    () => claims.map((claim) => ({
      id: claim.id,
      submitted: claim.created_at.slice(0, 10),
      teen: names[claim.member_id] || "Family member",
      claim: claim.title,
      status: statusLabels[claim.status],
      requested: claim.amount_cents,
      approved: claim.payout_cents,
      assessment: claim.ai ? (claim.ai.covered ? "Covered" : "Not covered") : "Not assessed",
      confidence: claim.ai ? `${Math.round(claim.ai.confidence * 100)}%` : "—",
      reference: claim.paypal_ref || "—",
    })),
    [claims, names],
  );

  const columnDefs = useMemo<ColDef<ClaimRow>[]>(
    () => [
      { field: "submitted", headerName: "Date", minWidth: 108, maxWidth: 125 },
      { field: "teen", headerName: "Teen", minWidth: 120 },
      { field: "claim", headerName: "Claim", minWidth: 160, flex: 1.5, tooltipField: "claim" },
      {
        field: "status",
        headerName: "Status",
        minWidth: 145,
        cellClassRules: {
          "font-semibold text-emerald-700": (p) => p.value === "Paid",
          "font-semibold text-amber-700": (p) => p.value === "Payout processing",
          "font-semibold text-rose-700": (p) => p.value === "Payout failed" || p.value === "Declined",
        },
      },
      {
        field: "requested",
        headerName: "Requested",
        minWidth: 120,
        type: "rightAligned",
        valueFormatter: (p) => fmt(Number(p.value ?? 0)),
      },
      {
        field: "approved",
        headerName: "Approved",
        minWidth: 120,
        type: "rightAligned",
        valueFormatter: (p) => p.value == null ? "—" : fmt(Number(p.value)),
      },
      { field: "assessment", headerName: "AI review", minWidth: 120 },
      { field: "confidence", headerName: "Confidence", minWidth: 110, maxWidth: 125 },
      { field: "reference", headerName: "PayPal reference", minWidth: 170, tooltipField: "reference" },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<ClaimRow>>(
    () => ({ sortable: true, resizable: true, filter: true }),
    [],
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">Search, sort and filter claim history</p>
        <span className="text-xs font-medium text-slate-500">{claims.length} claims</span>
      </div>
      <div style={{ height: 390, width: "100%" }}>
        <AgGridReact<ClaimRow>
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
          overlayNoRowsTemplate='<span class="text-sm text-slate-500">No claim history yet.</span>'
        />
      </div>
    </div>
  );
}
