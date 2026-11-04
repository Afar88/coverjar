"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AppState, Claim, Member } from "./types";
import { api, Badge, Button, Card, fmt, inputCls } from "./ui";
import { TopUp } from "./PayPalButton";
import { Chat } from "./Chat";

const RETURN_MESSAGES: Record<string, string> = {
  "topup=crypto-ok": "Crypto (PYUSD) payment completed and credited.",
  "topup=pending": "Crypto payment is still pending at PayPal.",
  "topup=cancelled": "Payment cancelled.",
  "topup=error": "Couldn't confirm the crypto payment.",
  "subscribe=active": "Weekly allowance subscription is active. Week 1 credited.",
  "subscribe=approved": "Weekly allowance subscription approved. Week 1 credited.",
  "subscribe=cancelled": "Subscription setup cancelled.",
  "subscribe=error": "Couldn't confirm the subscription.",
};

export default function App() {
  const params = useSearchParams();
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<string>("parent");
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
    api<AppState>("/api/state").then((s) => alive && setState(s));
    if (window.location.search) window.history.replaceState(null, "", "/");
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return <div className="p-10 text-slate-500">Loading Paraguas…</div>;
  const teens = state.members.filter((m) => m.role === "teen");
  const current = teens.find((t) => t.id === view);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span aria-hidden>☂️ </span>Para<span className="text-emerald-600">guas</span>
          </h1>
          <p className="text-sm text-slate-500">Allowance with a built-in protection jar. Gemini reviews claims, parents approve, PayPal pays.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.config.paypal === "sandbox" ? "blue" : "amber"}>PayPal: {state.config.paypal}</Badge>
          <Badge tone={state.config.ai === "offline-demo" ? "amber" : "green"}>AI: {state.config.ai}</Badge>
          <div className="ml-2 flex rounded-xl border border-slate-200 bg-white p-1">
            {[state.members.find((m) => m.role === "parent")!, ...teens].map((m) => (
              <button
                key={m.id}
                onClick={() => setView(m.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === m.id ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {m.emoji} {m.name}
                {m.role === "parent" ? " (parent)" : ""}
              </button>
            ))}
          </div>
        </div>
      </header>

      {toast && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${toast.error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{toast.msg}</div>
      )}

      {current ? (
        <TeenView key={current.id} teen={current} state={state} onDone={onDone} onError={onError} />
      ) : (
        <ParentView state={state} onDone={onDone} onError={onError} />
      )}
    </div>
  );
}

type Handlers = { onDone: (m: string) => void; onError: (m: string) => void };

function ParentView({ state, onDone, onError }: { state: AppState } & Handlers) {
  const teens = state.members.filter((m) => m.role === "teen");
  const pending = state.claims.filter((c) => c.status === "pending_parent");
  const decided = state.claims.filter((c) => c.status !== "pending_parent");
  const names = Object.fromEntries(state.members.map((m) => [m.id, m.name]));
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
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0">
                  <span>
                    <strong>{names[c.member_id]}</strong>: {c.title}
                  </span>
                  <span className="flex items-center gap-2">
                    {c.status === "paid" ? <Badge tone="green">Paid {fmt(c.payout_cents || 0)}</Badge> : <Badge tone="rose">Declined</Badge>}
                    {c.paypal_ref && <code className="text-xs text-slate-500">{c.paypal_ref}</code>}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Ledger state={state} />
      </div>
      <div className="space-y-6">
        <RulesCard state={state} onDone={onDone} onError={onError} />
        <Chat
          role="parent"
          title="Family assistant"
          intro="I can look up PayPal transactions, subscriptions and invoices, summarise claims, and adjust the jar rules for you."
          suggestions={["How are the jars doing?", "Show recent PayPal transactions", "Raise the jar share to 25%"]}
        />
      </div>
    </div>
  );
}

function TeenFundingCard({ teen, state, onDone, onError }: { teen: Member; state: AppState } & Handlers) {
  const [amount, setAmount] = useState((teen.allowance_cents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const b = teen.balances!;
  async function subscribe() {
    setBusy(true);
    try {
      const r = await api<{ id: string; approveUrl: string | null }>("/api/subscribe", { memberId: teen.id });
      if (r.approveUrl) window.location.href = r.approveUrl;
      // Simulated mode: hit the API return route directly, which redirects back with a status.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      else window.location.href = `/api/subscribe/return?member=${teen.id}&subscription_id=${r.id}`;
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card title={`${teen.emoji} ${teen.name}${teen.age ? `, ${teen.age}` : ""}`} right={<Badge>{fmt(teen.allowance_cents)}/week</Badge>}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Spending money</div>
          <div className="text-xl font-semibold">{fmt(b.spend)}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <div className="text-xs text-emerald-700">Protection jar</div>
          <div className="text-xl font-semibold text-emerald-800">{fmt(b.jar)}</div>
        </div>
      </div>
      <label className="mb-1 block text-xs font-medium text-slate-600">Top up allowance ($)</label>
      <input className={`${inputCls} mb-2`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      <p className="mb-3 text-xs text-slate-500">{state.rules.jar_percent}% goes into the protection jar automatically.</p>
      <TopUp memberId={teen.id} amount={amount} clientId={state.config.paypalClientId} cryptoEnabled={state.config.cryptoEnabled} onDone={onDone} onError={onError} />
      <div className="mt-3">
        <Button variant="ghost" onClick={subscribe} disabled={busy}>
          ↻ Automate weekly allowance with PayPal Subscriptions
        </Button>
      </div>
    </Card>
  );
}

function AiPanel({ claim }: { claim: Claim }) {
  const ai = claim.ai;
  if (!ai) return null;
  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-emerald-900">✦ Gemini review</span>
        <Badge tone={ai.covered ? "green" : "rose"}>{ai.covered ? "Covered" : "Not covered"}</Badge>
        <Badge>{ai.category}</Badge>
        <Badge tone="blue">{Math.round(ai.confidence * 100)}% confident</Badge>
        <span className="text-xs text-slate-500">{ai.model}</span>
      </div>
      <p className="mb-2 text-slate-800">{ai.parent_summary}</p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <dt className="text-slate-500">Photo shows</dt>
        <dd>{ai.damage_observed}</dd>
        <dt className="text-slate-500">Rule</dt>
        <dd>{ai.coverage_reason}</dd>
        <dt className="text-slate-500">Typical repair</dt>
        <dd>{fmt(ai.estimated_repair_cents)}</dd>
        <dt className="text-slate-500">Recommended payout</dt>
        <dd className="font-semibold">
          {fmt(ai.final_payout_cents)}
          {ai.caps_applied.length > 0 && <span className="font-normal text-slate-500"> (capped: {ai.caps_applied.join(", ")})</span>}
        </dd>
      </dl>
      {ai.risk_flags.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-amber-800">
          {ai.risk_flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ParentClaim({ claim, teenName, state, onDone, onError }: { claim: Claim; teenName: string; state: AppState } & Handlers) {
  const [amount, setAmount] = useState(((claim.ai?.final_payout_cents ?? 0) / 100).toFixed(2));
  const [payee, setPayee] = useState(claim.ai?.payee ?? "repair_shop");
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    try {
      const r = await api<Claim & { payoutStatus?: string }>(`/api/claims/${claim.id}/decide`, { decision, amount, payee });
      onDone(decision === "approve" ? `Paid ${amount} via PayPal Payouts (${r.paypal_ref}, ${r.payoutStatus}).` : "Claim declined.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap gap-4">
        {claim.photo_file && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/photos/${claim.id}`} alt="Damage" className="h-28 w-28 rounded-lg object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {teenName}: {claim.title}
          </div>
          <p className="text-sm text-slate-600">{claim.description}</p>
          <p className="mt-1 text-sm">
            Asked for <strong>{fmt(claim.amount_cents)}</strong>
          </p>
        </div>
      </div>
      <AiPanel claim={claim} />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500">Payout ($)</label>
          <input className={`${inputCls} w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Pay to</label>
          <select className={inputCls} value={payee} onChange={(e) => setPayee(e.target.value as "repair_shop" | "parent")}>
            <option value="repair_shop">Repair shop ({state.rules.repair_shop_email})</option>
            <option value="parent">Me, for a replacement</option>
          </select>
        </div>
        <Button onClick={() => decide("approve")} disabled={busy}>Approve & pay with PayPal</Button>
        <Button variant="danger" onClick={() => decide("deny")} disabled={busy}>Decline</Button>
      </div>
    </div>
  );
}

function RulesCard({ state, onDone, onError }: { state: AppState } & Handlers) {
  const r = state.rules;
  const [form, setForm] = useState({
    jar_percent: String(r.jar_percent),
    deductible: (r.deductible_cents / 100).toFixed(2),
    max_payout: (r.max_payout_cents / 100).toFixed(2),
    covered: r.covered.join("\n"),
    excluded: r.excluded.join("\n"),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  async function save() {
    try {
      await api("/api/rules", {
        jar_percent: form.jar_percent,
        deductible: form.deductible,
        max_payout: form.max_payout,
        covered: form.covered.split("\n").map((s) => s.trim()).filter(Boolean),
        excluded: form.excluded.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      onDone("Family rules saved.");
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <Card title="Family rules">
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-slate-500">
          Jar %<input className={inputCls} value={form.jar_percent} onChange={set("jar_percent")} />
        </label>
        <label className="text-xs text-slate-500">
          Deductible $<input className={inputCls} value={form.deductible} onChange={set("deductible")} />
        </label>
        <label className="text-xs text-slate-500">
          Max payout $<input className={inputCls} value={form.max_payout} onChange={set("max_payout")} />
        </label>
      </div>
      <label className="mt-3 block text-xs text-slate-500">
        Covered (one per line)
        <textarea className={`${inputCls} h-24`} value={form.covered} onChange={set("covered")} />
      </label>
      <label className="mt-2 block text-xs text-slate-500">
        Not covered
        <textarea className={`${inputCls} h-24`} value={form.excluded} onChange={set("excluded")} />
      </label>
      <div className="mt-3">
        <Button variant="secondary" onClick={save}>Save rules</Button>
      </div>
    </Card>
  );
}

function Ledger({ state, memberId }: { state: AppState; memberId?: string }) {
  const names = Object.fromEntries(state.members.map((m) => [m.id, m.name]));
  const rows = state.ledger.filter((l) => !memberId || l.member_id === memberId).slice(0, 25);
  return (
    <Card title="Activity">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="pb-2">When</th>
              {!memberId && <th className="pb-2">Who</th>}
              <th className="pb-2">What</th>
              <th className="pb-2">Bucket</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-500">{l.created_at.slice(0, 10)}</td>
                {!memberId && <td>{names[l.member_id]}</td>}
                <td>
                  {l.memo}
                  {l.paypal_ref && l.paypal_ref !== "SEED" && <span className="ml-1 font-mono text-xs text-slate-400">{l.paypal_ref}</span>}
                </td>
                <td>
                  <Badge tone={l.bucket === "jar" ? "green" : "slate"}>{l.bucket === "jar" ? "jar" : "spending"}</Badge>
                </td>
                <td className={`text-right font-medium ${l.amount_cents < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmt(l.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TeenView({ teen, state, onDone, onError }: { teen: Member; state: AppState } & Handlers) {
  const b = teen.balances!;
  const claims = state.claims.filter((c) => c.member_id === teen.id);
  const [busy, setBusy] = useState(false);
  const [buy, setBuy] = useState({ amount: "", memo: "" });

  async function fileClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    fd.set("memberId", teen.id);
    setBusy(true);
    try {
      await api("/api/claims", fd, true);
      formEl.reset();
      onDone("Claim sent! Gemini reviewed it and it's now with your parent.");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logPurchase() {
    try {
      await api("/api/purchase", { memberId: teen.id, ...buy });
      setBuy({ amount: "", memo: "" });
      onDone("Purchase logged.");
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-900 p-5 text-white">
            <div className="text-sm text-slate-300">Spending money</div>
            <div className="text-3xl font-bold">{fmt(b.spend)}</div>
            <div className="mt-3 flex gap-2">
              <input className="w-16 min-w-0 rounded-lg bg-slate-800 px-2 py-1 text-sm" placeholder="$" value={buy.amount} onChange={(e) => setBuy({ ...buy, amount: e.target.value })} />
              <input className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1 text-sm" placeholder="What did you buy?" value={buy.memo} onChange={(e) => setBuy({ ...buy, memo: e.target.value })} />
              <button onClick={logPurchase} className="shrink-0 rounded-lg bg-white px-3 text-sm font-medium text-slate-900">Log</button>
            </div>
          </div>
          <div className="rounded-2xl bg-emerald-600 p-5 text-white">
            <div className="text-sm text-emerald-100">🛡️ Protection jar</div>
            <div className="text-3xl font-bold">{fmt(b.jar)}</div>
            <p className="mt-3 text-sm text-emerald-50">
              {state.rules.jar_percent}% of every allowance lands here. It covers accidents up to {fmt(state.rules.max_payout_cents)} (you pay the first {fmt(state.rules.deductible_cents)}).
            </p>
          </div>
        </div>

        <Card title="Something broke? File a claim">
          <form onSubmit={fileClaim} className="space-y-3">
            <input name="title" className={inputCls} placeholder="e.g. Cracked phone screen" required />
            <textarea name="description" className={`${inputCls} h-24`} placeholder="What happened? Be honest, Gemini checks the photo." required />
            <div className="flex flex-wrap gap-3">
              <input name="amount" className={`${inputCls} w-40`} placeholder="Repair cost ($)" inputMode="decimal" required />
              <input name="photo" type="file" accept="image/*" className="text-sm" />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Gemini is reviewing…" : "Send claim"}</Button>
          </form>
        </Card>

        {claims.length > 0 && (
          <Card title="My claims">
            <div className="space-y-3">
              {claims.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <strong>{c.title}</strong>
                    {c.status === "pending_parent" && <Badge tone="amber">Waiting for parent</Badge>}
                    {c.status === "paid" && <Badge tone="green">Paid {fmt(c.payout_cents || 0)}</Badge>}
                    {c.status === "denied" && <Badge tone="rose">Not covered</Badge>}
                  </div>
                  {c.ai && <p className="mt-1 text-slate-600">✦ {c.ai.teen_message}</p>}
                </div>
              ))}
            </div>
          </Card>
        )}
        <Ledger state={state} memberId={teen.id} />
      </div>
      <div>
        <Chat
          role="teen"
          memberId={teen.id}
          title="Jarvis, your money coach"
          intro={`Hey ${teen.name}! Ask me about your jar, what's covered, or how to save for something.`}
          suggestions={["How much is in my jar?", "Is a cracked screen covered?", "How long to save $60?"]}
        />
      </div>
    </div>
  );
}
