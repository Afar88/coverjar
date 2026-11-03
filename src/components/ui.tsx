"use client";
import type { ReactNode } from "react";

export const fmt = (cents: number) => (cents < 0 ? "-" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    danger: "bg-white text-rose-700 border border-rose-300 hover:bg-rose-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "rose" | "blue" }) {
  const t = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-800",
    blue: "bg-sky-100 text-sky-800",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export async function api<T>(url: string, body?: unknown, isForm = false): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
