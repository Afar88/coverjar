"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { upload } from "@vercel/blob/client";
import type { AppState, Claim, Member } from "./types";
import { api, Badge, Button, Card, fmt, inputCls } from "./ui";
import { TopUp } from "./PayPalButton";
import { Chat } from "./Chat";

const RETURN_MESSAGES: Record<string, string> = {
  "topup=crypto-ok": "Crypto (PYUSD) payment completed and credited.",
  "topup=pending": "Crypto payment is still pending at PayPal.",
  "topup=cancelled": "Payment cancelled.",
  "topup=error": "Couldn't confirm the crypto payment.",
  "subscribe=active": "Weekly allowance subscription is active. PayPal will confirm the first allowance payment shortly.",
  "subscribe=approved": "Subscription approved. Your allowance will be added when PayPal confirms the payment.",
  "subscribe=cancelled": "Subscription setup cancelled.",
  "subscribe=error": "Couldn't confirm the subscription.",
};

export default function App() {
  const params = useSearchParams();
  const [state, setState] = useState<AppState | null>(null);
  const [session, setSession] = useState<{ role: "parent" | "teen"; memberId: string } | null>(null);
  const [loginOptions, setLoginOptions] = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [role, setRole] = useState<"parent" | "teen">("parent");
  const [memberId, setMemberId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(() => {
    for (const [k, msg] of Object.entries(RETURN_MESSAGES)) {
      const [key, val] = k.split("=");
      if (params.get(key) === val) return { msg, error: val === "error" };
    }
    return null;
  });

  const refresh = useCallback(async () => setState(await api<AppState>("/api/state")), []);
  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 6000);
  }, []);
  const onDone = useCallback((msg: string) => { notify(msg); refresh(); }, [notify, refresh]);
  const onError = useCallback((msg: string) => notify(msg, true), [notify]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ authenticated: boolean; session: { role: "parent" | "teen"; memberId: string } | null }>("/api/auth/session"),
      api<{ teens: { id: string; name: string; emoji: string }[] }>("/api/auth/options"),
    ]).then(async ([auth, options]) => {
      if (!alive) return;
      setLoginOptions(options.teens);
      if (auth.authenticated && auth.session) {
        setSession(auth.session);
        const next = await api<AppState>("/api/state");
        if (alive) setState(next);
      }
    }).catch(() => { if (alive) notify("Couldn't load Paraguas. Refresh and try again.", true); });
    if (window.location.search) window.history.replaceState(null, "", "/");
    return () => { alive = false; };
  }, [notify]);

  // Keep an already-open teen dashboard in sync when a parent changes allowance.
  useEffect(() => {
    if (!session) return;
    let active = true;
    const sync = async () => {
      try {
        const next = await api<AppState>("/api/state");
        if (active) setState(next);
      } catch {
        // A temporary network error should not blank the current dashboard.
      }
    };
    const interval = window.setInterval(sync, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [session]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ role: "parent" | "teen"; memberId: string }>("/api/auth/login", {
        role, memberId: role === "parent" ? "parent" : memberId, pin,
      });
      setSession(result);
      setPin("");
      setState(await api<AppState>("/api/state"));
      notify("You're signed in.");
    } catch (error) {
      notify((error as Error).message, true);
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(`Logout failed (${response.status})`);
      window.location.replace("/");
    } catch (error) {
      notify((error as Error).message || "Couldn't log out. Please try again.", true);
      setBusy(false);
    }
  }

  if (!session || !state) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-7 text-center">
          <h1 className="text-3xl font-bold tracking-tight"><span aria-hidden>☂️ </span>Para<span className="text-emerald-600">guas</span></h1>
          <p className="mt-2 text-sm text-slate-500">Your family's allowance and protection fund.</p>
        </div>
        <form onSubmit={signIn} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setRole("parent")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${role === "parent" ? "bg-white shadow-sm" : "text-slate-500"}`}>Parent</button>
            <button type="button" onClick={() => setRole("teen")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${role === "teen" ? "bg-white shadow-sm" : "text-slate-500"}`}>Teen</button>
          </div>
          {role === "teen" && (
            <label className="block text-sm font-medium">Your profile
              <select className={`${inputCls} mt-1`} value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
                <option value="">Choose your profile</option>
                {loginOptions.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">Passcode
            <input className={`${inputCls} mt-1`} type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} minLength={4} maxLength={12} required placeholder="Enter your passcode" />
          </label>
          <Button type="submit" disabled={busy || (role === "teen" && !memberId)}>{busy ? "Signing in…" : "Sign in"}</Button>
          {toast && <p className={`text-sm ${toast.error ? "text-rose-700" : "text-emerald-700"}`}>{toast.msg}</p>}
        </form>
      </div>
    );
  }

  const current = session.role === "teen" ? state.members.find((m) => m.id === session.memberId) : null;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight"><span aria-hidden>☂️ </span>Para<span className="text-emerald-600">guas</span></h1>
          <p className="text-sm text-slate-500"><em>Paraguas</em> is Spanish for <strong>&ldquo;umbrella&rdquo;</strong>. AI assists with claims, parents decide, PayPal pays.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{session.role === "parent" ? "Parent account" : current?.name}</Badge>
          <Button variant="secondary" onClick={signOut} disabled={busy}>Log out</Button>
        </div>
      </header>
      {toast && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${toast.error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{toast.msg}</div>}
      {session.role === "parent" ? <ParentView state={state} onDone={onDone} onError={onError} /> :
        current ? <TeenView key={current.id} teen={current} state={state} onDone={onDone} onError={onError} /> :
        <p className="text-sm text-rose-700">Teen profile unavailable. Sign out and sign in again.</p>}
    </div>
  );
}

type Handlers = { onDone: (m: string) => void; onError: (m: string) => void };

function ParentView({ state, onDone, onError }: { state: AppState } & Handlers) {
  const teens = state.members.filter((m) => m.role === "teen");
  const pending = state.claims.filter((c) => c.status === "pending_parent");
  const decided = state.claims.filter((c) => c.status !== "pending_parent");
  const names = Object.fromEntries(state.members.map((m) => [m.id, m.name]));
  async function reconcileClaim(id: number) {
    try {
      const result = await api<{ status: string; message?: string }>(`/api/claims/${id}/reconcile`, {});
      onDone(result.status === "paid" ? "PayPal confirmed the claim payout." : result.message || "PayPal status checked.");
    } catch (error) { onError((error as Error).message); }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {teens.map((t) => (
            <TeenFundingCard key={t.id} teen={t} state={state} onDone={onDone} onError={onError} />
          ))}
        </div>
        <Card title={`Claims waiting for you (${pending.length})`}>
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">No claims to review. Switch to a teen to file one.</p>
          ) : (
            <div className="space-y-4">
              {pending.map((c) => (
                <ParentClaim key={c.id} claim={c} teenName={names[c.member_id]} state={state} onDone={onDone} onError={onError} />
              ))}
            </div>
          )}
        </Card>
        {decided.length > 0 && (
          <Card title="Decided claims">
            <div className="space-y-2">
              {decided.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{names[c.member_id]}: {c.title}</strong>
                    {c.status === "paid" ? <Badge tone="green">Paid {fmt(c.payout_cents || 0)}</Badge> : c.status === "payout_pending" ? <Badge tone="amber">Payout processing</Badge> : c.status === "payout_failed" ? <Badge tone="rose">Payout failed</Badge> : <Badge tone="rose">Declined</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Requested {fmt(c.amount_cents)} · Submitted {new Date(c.created_at.replace(" ", "T") + "Z").toLocaleString()}</p>
                  {c.ai && <div className="mt-2"><AiPanel claim={c} /></div>}
                  {c.payout_cents !== null && <p className="mt-2">Approved amount: <strong>{fmt(c.payout_cents)}</strong></p>}
                  {c.parent_note && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-slate-700">Parent note: {c.parent_note}</p>}
                  {c.paypal_ref && <p className="mt-1 break-all font-mono text-xs text-slate-500">PayPal reference: {c.paypal_ref}</p>}
                  {c.status === "payout_pending" && <div className="mt-3"><Button variant="secondary" onClick={() => reconcileClaim(c.id)}>Check PayPal payout status</Button><p className="mt-1 text-xs text-slate-500">This checks the existing transfer; it does not send another payment.</p></div>}
                </div>
              ))}
            </div>
          )}
        </Card>
        {decided.length > 0 && <Ledger state={state} />}
      </div>
      <div className="space-y-6">
        <RulesCard state={state} onDone={onDone} onError={onError} />
        <Chat persona="parent" title="Family assistant" intro="I can look up PayPal transactions, subscriptions and invoices, summarise claims, and adjust the umbrella rules for you." suggestions={["How are the umbrella funds doing?", "Show recent PayPal transactions", "Raise the umbrella share to 25%"]} />
      </div>
    </div>
  );
}

function TeenFundingCard({ teen, state, onDone, onError }: { teen: Member; state: AppState } & Handlers) {
  const [amount, setAmount] = useState((teen.allowance_cents / 100).toFixed(2));
  const [topUpAmount, setTopUpAmount] = useState("10.00");
  const [busy, setBusy] = useState(false);
  const [savingAllowance, setSavingAllowance] = useState(false);
  useEffect(() => setAmount((teen.allowance_cents / 100).toFixed(2)), [teen.allowance_cents]);
  const b = teen.balances!;
  async function saveAllowance() {
    setSavingAllowance(true);
    try {
      await api("/api/allowance", { memberId: teen.id, amount });
      onDone(`Weekly allowance for ${teen.name} saved as ${Number(amount).toFixed(2)}.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSavingAllowance(false);
    }
  }
  async function subscribe() {
    setBusy(true);
    try {
      const r = await api<{ id: string; approveUrl: string | null }>("/api/subscribe", { memberId: teen.id });
      if (r.approveUrl) window.location.href = r.approveUrl;
      else window.location.href = `/api/subscribe/return?member=${teen.id}&subscription_id=${r.id}`;
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card title={`${teen.emoji} ${teen.name}${teen.age ? `, ${teen.age}` : ""}`} right={<Badge>{fmt(teen.allowance_cents)}/week</Badge>}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Spending money</div><div className="text-xl font-semibold">{fmt(b.spend)}</div></div>
        <div className="rounded-xl bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Umbrella fund</div><div className="text-xl font-semibold text-emerald-800">{fmt(b.jar)}</div></div>
      </div>
      <div className="mb-4 rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-sm text-slate-800">Weekly allowance</strong><Badge tone="green">Saved: {fmt(teen.allowance_cents)}/week</Badge></div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Set weekly amount ($)</label>
        <input className={`${inputCls} mb-2`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={`Weekly allowance for ${teen.name}`} />
        <p className="mb-3 text-xs text-slate-500">This changes the saved weekly allowance only. No payment is taken. {state.rules.jar_percent}% is allocated to the umbrella fund when allowance is paid.</p>
        <Button onClick={saveAllowance} disabled={savingAllowance || !/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 1 || Number(amount) > 500}>{savingAllowance ? "Saving…" : "Save weekly allowance"}</Button>
      </div>
      <div className="rounded-xl bg-slate-50 p-3">
        <strong className="text-sm text-slate-800">Make a one-time top-up</strong>
        <p className="mb-2 mt-1 text-xs text-slate-500">Add extra money now. PayPal checkout opens only when you choose to pay.</p>
        <label className="mb-1 block text-xs font-medium text-slate-600">Top-up amount ($)</label>
        <input className={`${inputCls} mb-3`} value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} inputMode="decimal" aria-label={`One-time top-up for ${teen.name}`} />
        <TopUp memberId={teen.id} amount={topUpAmount} clientId={state.config.paypalClientId} cryptoEnabled={state.config.cryptoEnabled} onDone={onDone} onError={onError} />
      </div>
      {teen.streak && <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-emerald-900">Saving streak</strong><Badge tone={teen.streak.eligible ? "green" : "slate"}>{Math.min(teen.streak.weeks, 4)}/4 weeks</Badge></div>{teen.streak.eligible ? <><p className="mt-1 text-xs text-emerald-800">Great consistency. Fund a ${(teen.streak.bonusCents / 100).toFixed(2)} parent match directly into {teen.name}&apos;s umbrella fund.</p><div className="mt-2"><TopUp purpose="streak_bonus" memberId={teen.id} amount={(teen.streak.bonusCents / 100).toFixed(2)} clientId={state.config.paypalClientId} cryptoEnabled={false} onDone={onDone} onError={onError} /></div></> : teen.streak.alreadyMatched ? <p className="mt-1 text-xs text-emerald-800">A match payment is pending or this streak has already been matched.</p> : <p className="mt-1 text-xs text-slate-600">Four consecutive weeks of allowance savings unlock a parent-funded match.</p>}</div>}
      <div className="mt-3"><Button variant="ghost" onClick={subscribe} disabled={busy}>↻ Automate weekly allowance with PayPal Subscriptions</Button></div>
    </Card>
  );
}
