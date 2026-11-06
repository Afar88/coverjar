"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { upload } from "@vercel/blob/client";
import type { AppState, Claim, Member } from "./types";
import { api, Badge, Button, Card, fmt, inputCls } from "./ui";
import { TopUp } from "./PayPalButton";
import { Chat } from "./Chat";
import { LedgerGrid } from "./LedgerGrid";
import { ClaimsGrid } from "./ClaimsGrid";

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
  const [session, setSession] = useState<{ role: "parent" | "teen"; memberId: string; familyId: string } | null>(null);
  const [loginOptions, setLoginOptions] = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [role, setRole] = useState<"parent" | "teen">("parent");
  const [memberId, setMemberId] = useState("");
  const [pin, setPin] = useState("");
  const [familyCode,setFamilyCode]=useState("");
  const [parentName,setParentName]=useState("");
  const [password,setPassword]=useState("");
  const [registerMode,setRegisterMode]=useState(false);
  const [issuedFamilyCode,setIssuedFamilyCode]=useState("");
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
    if(!familyCode){setLoginOptions([]);setMemberId("");return;}
    api<{teens:{id:string;name:string;emoji:string}[]}>(`/api/auth/options?familyCode=${encodeURIComponent(familyCode)}`).then(result=>{if(alive){setLoginOptions(result.teens);setMemberId("");}}).catch(()=>{if(alive)setLoginOptions([]);});
    return ()=>{alive=false;};
  },[familyCode]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ authenticated: boolean; session: { role: "parent" | "teen"; memberId: string; familyId: string } | null }>("/api/auth/session"),
    ]).then(async ([auth]) => {
      if (!alive) return;
      if (auth.authenticated && auth.session) {
        setSession(auth.session);
        const next = await api<AppState>("/api/state");
        if (alive) setState(next);
      }
    }).catch(() => { if (alive) notify("Couldn't load Paraguas. Refresh and try again.", true); });
    if (window.location.search) window.history.replaceState(null, "", "/");
    return () => { alive = false; };
  }, [notify]);

  // Keep already-open dashboards in sync when a parent changes an allowance.
  useEffect(() => {
    if (!session) return;
    let active = true;
    const sync = async () => {
      try {
        const next = await api<AppState>("/api/state");
        if (active) setState(next);
      } catch {
        // Keep the last good state during temporary network failures.
      }
    };
    const interval = window.setInterval(sync, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [session]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ role: "parent" | "teen"; memberId: string; familyId?: string; familyCode?:string }>("/api/auth/login", {
        role, familyCode, memberId: role === "parent" ? undefined : memberId, pin, password,
      });
      setSession({...result,familyId:result.familyId||"legacy-family"});
      setIssuedFamilyCode(result.familyCode||"");
      setPin("");
      setState(await api<AppState>("/api/state"));
      notify("You're signed in.");
    } catch (error) {
      notify((error as Error).message, true);
    } finally { setBusy(false); }
  }

  async function registerParent(e:React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const result=await api<{role:"parent";memberId:string;familyId:string;familyCode:string}>("/api/auth/register",{name:parentName,password});
      setSession(result); setIssuedFamilyCode(result.familyCode);
      setState(await api<AppState>("/api/state"));
      setPassword("");
      notify("Family created. Save your family code somewhere safe.");
    } catch(error) { notify((error as Error).message,true); }
    finally { setBusy(false); }
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
      // Reload from the server so the cleared HttpOnly cookie is checked afresh.
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
          <p className="mt-2 text-sm text-slate-500">Your family&apos;s allowance and protection fund.</p>
        </div>
        <form onSubmit={registerMode?registerParent:signIn} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!registerMode && <div className="flex rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setRole("parent")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${role === "parent" ? "bg-white shadow-sm" : "text-slate-500"}`}>Parent</button>
            <button type="button" onClick={() => setRole("teen")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${role === "teen" ? "bg-white shadow-sm" : "text-slate-500"}`}>Teen</button>
          </div>}
          {registerMode ? <>
            <label className="block text-sm font-medium">Parent name<input className={inputCls+" mt-1"} value={parentName} onChange={e=>setParentName(e.target.value)} required maxLength={80} /></label>
            <label className="block text-sm font-medium">Password<input className={inputCls+" mt-1"} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={10} required placeholder="At least 10 characters" /></label>
          </> : <>
          <label className="block text-sm font-medium">Family code<input className={inputCls+" mt-1 uppercase"} value={familyCode} onChange={e=>setFamilyCode(e.target.value.toUpperCase())} required placeholder="FAM-XXXX-XXXX" /></label>
          {role === "teen" && (
            <label className="block text-sm font-medium">Your profile
              <select className={`${inputCls} mt-1`} value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
                <option value="">Choose your profile</option>
                {loginOptions.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">{role==="parent"?"Password":"Teen PIN"}
            <input className={`${inputCls} mt-1`} type="password" inputMode={role==="teen"?"numeric":"text"} autoComplete="current-password" value={role==="parent"?password:pin} onChange={(e) => role==="parent"?setPassword(e.target.value):setPin(e.target.value)} minLength={role==="parent"?10:4} maxLength={role==="parent"?128:12} required placeholder={role==="parent"?"Enter your password":"Enter your PIN"} />
          </label>
          </>}
          <Button type="submit" disabled={busy || (!registerMode && role === "teen" && !memberId)}>{busy ? "Please wait…" : registerMode?"Create family": "Sign in"}</Button>
          <button type="button" className="w-full text-sm text-emerald-700" onClick={()=>setRegisterMode(v=>!v)}>{registerMode?"Already have a family? Sign in":"New to Paraguas? Create a family"}</button>
          {toast && <p className={`text-sm ${toast.error ? "text-rose-700" : "text-emerald-700"}`}>{toast.msg}</p>}
        </form>
      </div>
    );
  }

  const current = session.role === "teen" ? state.members.find((m) => m.id === session.memberId) : null;
  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-[1.7rem] font-bold tracking-[-0.055em] text-slate-950"><span aria-hidden>☂️ </span>Para<span className="text-emerald-600">guas</span></h1>
          <p className="mt-1 text-sm text-slate-500">Family money, made clearer. AI helps review claims; parents stay in control.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{session.role === "parent" ? "Parent account" : current?.name}</Badge>
          <Button variant="secondary" onClick={signOut} disabled={busy}>Log out</Button>
        </div>
      </header>
      {issuedFamilyCode && session.role==="parent" && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">Your family code: <strong className="select-all">{issuedFamilyCode}</strong>. Share this code with your teens so they can sign in.</div>}
      {toast && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${toast.error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{toast.msg}</div>}
      {session.role === "parent" ? <ParentView state={state} onDone={onDone} onError={onError} /> :
        current ? <TeenView key={current.id} teen={current} familyId={session.familyId} state={state} onDone={onDone} onError={onError} /> :
        <p className="text-sm text-rose-700">Teen profile unavailable. Sign out and sign in again.</p>}
    </div>
  );
}

type Handlers = { onDone: (m: string) => void; onError: (m: string) => void };

function ParentView({ state, onDone, onError }: { state: AppState } & Handlers) {
  const [teenName,setTeenName]=useState("");
  const [teenPin,setTeenPin]=useState("");
  const [addingTeen,setAddingTeen]=useState(false);
  const teens = state.members.filter((m) => m.role === "teen");
  const pending = state.claims.filter((c) => c.status === "pending_parent");
  const decided = state.claims.filter((c) => c.status !== "pending_parent");
  const names = Object.fromEntries(state.members.map((m) => [m.id, m.name]));
  const totalSpend = teens.reduce((sum, teen) => sum + (teen.balances?.spend ?? 0), 0);
  const totalJar = teens.reduce((sum, teen) => sum + (teen.balances?.jar ?? 0), 0);
  async function addTeen(e:React.FormEvent) {
    e.preventDefault();setAddingTeen(true);
    try { await api("/api/family/teens",{name:teenName,pin:teenPin});setTeenName("");setTeenPin("");onDone("Teen profile created. Share your family code and their PIN with them."); }
    catch(error){onError((error as Error).message);}
    finally{setAddingTeen(false);}
  }
  async function reconcileClaim(id: number) {
    try {
      const result = await api<{ status: string; message?: string }>(`/api/claims/${id}/reconcile`, {});
      onDone(result.status === "paid" ? "PayPal confirmed the claim payout." : result.message || "PayPal status checked.");
    } catch (error) { onError((error as Error).message); }
  }
  return (
    <div className="space-y-5">
      <form onSubmit={addTeen} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[150px] flex-1"><label className="text-xs font-medium text-slate-600">Add teen name<input className={inputCls+" mt-1"} value={teenName} onChange={e=>setTeenName(e.target.value)} maxLength={80} required placeholder="Teen name" /></label></div>
        <div className="w-36"><label className="text-xs font-medium text-slate-600">Create PIN<input className={inputCls+" mt-1"} value={teenPin} onChange={e=>setTeenPin(e.target.value)} inputMode="numeric" type="password" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required placeholder="4–12 digits" /></label></div>
        <Button type="submit" disabled={addingTeen}>{addingTeen?"Adding…":"Add teen"}</Button>
      </form>
      <section aria-label="Family financial overview" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Teens</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{teens.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Combined spending</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{fmt(totalSpend)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium text-emerald-700">Umbrella funds</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-emerald-900">{fmt(totalJar)}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium text-amber-800">Claims to review</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-amber-950">{pending.length}</p>
        </div>
      </section>
      <nav aria-label="Parent dashboard sections" className="sticky top-2 z-20 -mx-1 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur sm:mx-0">
        {[["#family","Family"],["#review-claims","Claims"],["#claim-history","History"],["#family-activity","Activity"],["#family-rules","Rules"],["#family-assistant","AI assistant"]].map(([href,label]) => (
          <a key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-800">{label}</a>
        ))}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-5 lg:col-span-8">
        <div id="family" className="grid scroll-mt-24 gap-4 sm:grid-cols-2">
          {teens.map((t) => (
            <TeenFundingCard key={t.id} teen={t} state={state} onDone={onDone} onError={onError} />
          ))}
        </div>
        <Card title={`Claims waiting for you (${pending.length})`}><div id="review-claims" className="scroll-mt-24">
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">No claims to review. Switch to a teen to file one.</p>
          ) : (
            <div className="space-y-4">
              {pending.map((c) => (
                <ParentClaim key={c.id} claim={c} teenName={names[c.member_id]} state={state} onDone={onDone} onError={onError} />
              ))}
            </div>
          )}
        </div></Card>
        {decided.length > 0 && (
          <Card title={`Claim history (${decided.length})`}><div id="claim-history" className="scroll-mt-24">
            <ClaimsGrid claims={decided} names={names} />
            {decided.some((claim) => claim.status === "payout_pending") && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-slate-600">Payouts still being checked</p>
                {decided.filter((claim) => claim.status === "payout_pending").map((claim) => (
                  <div key={claim.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
                    <div className="min-w-0">
                      <strong>{names[claim.member_id]} · {claim.title}</strong>
                      <p className="text-xs text-slate-600">Funds remain reserved while PayPal confirms the transfer.</p>
                    </div>
                    <Button variant="secondary" onClick={() => reconcileClaim(claim.id)}>Check PayPal status</Button>
                  </div>
                ))}
              </div>
            )}
          </div></Card>
        )}
        <div id="family-activity" className="scroll-mt-24"><Ledger state={state} /></div>
      </div>
      <div className="space-y-5 lg:col-span-4">
        <div id="family-rules" className="scroll-mt-24"><RulesCard state={state} onDone={onDone} onError={onError} /></div>
        <div id="family-assistant" className="scroll-mt-24"><Chat
          persona="parent"
          title="Family assistant"
          intro="I can look up PayPal transactions, subscriptions and invoices, summarise claims, and adjust the umbrella rules for you."
          suggestions={["How are the umbrella funds doing?", "Show recent PayPal transactions", "Raise the umbrella share to 25%"]}
        /></div>
      </div>
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
          <div className="text-xs text-emerald-700">Umbrella fund</div>
          <div className="text-xl font-semibold text-emerald-800">{fmt(b.jar)}</div>
        </div>
      </div>
      <div className="mb-4 rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <strong className="text-sm text-slate-800">Weekly allowance</strong>
          <Badge tone="green">Saved: {fmt(teen.allowance_cents)}/week</Badge>
        </div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Set weekly amount ($)</label>
        <input className={`${inputCls} mb-2`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={`Weekly allowance for ${teen.name}`} />
        <p className="mb-3 text-xs text-slate-500">This changes the saved weekly allowance only. No payment is taken. {state.rules.jar_percent}% is allocated to the umbrella fund when allowance is paid.</p>
        <Button onClick={saveAllowance} disabled={savingAllowance || !/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 1 || Number(amount) > 500}>
          {savingAllowance ? "Saving…" : "Save weekly allowance"}
        </Button>
      </div>
      <div className="rounded-xl bg-slate-50 p-3">
        <strong className="text-sm text-slate-800">Make a one-time top-up</strong>
        <p className="mb-2 mt-1 text-xs text-slate-500">Add extra money now. PayPal checkout opens only when you choose to pay.</p>
        <label className="mb-1 block text-xs font-medium text-slate-600">Top-up amount ($)</label>
        <input className={`${inputCls} mb-3`} value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} inputMode="decimal" aria-label={`One-time top-up for ${teen.name}`} />
        <TopUp memberId={teen.id} amount={topUpAmount} clientId={state.config.paypalClientId} cryptoEnabled={state.config.cryptoEnabled} onDone={onDone} onError={onError} />
      </div>
      {teen.streak && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-emerald-900">Saving streak</strong>
            <Badge tone={teen.streak.eligible ? "green" : "slate"}>{Math.min(teen.streak.weeks, 4)}/4 weeks</Badge>
          </div>
          {teen.streak.eligible ? (
            <>
              <p className="mt-1 text-xs text-emerald-800">Great consistency. Fund a ${(teen.streak.bonusCents / 100).toFixed(2)} parent match directly into {teen.name}&apos;s umbrella fund.</p>
              <div className="mt-2">
                <TopUp purpose="streak_bonus" memberId={teen.id} amount={(teen.streak.bonusCents / 100).toFixed(2)} clientId={state.config.paypalClientId} cryptoEnabled={false} onDone={onDone} onError={onError} />
              </div>
            </>
          ) : teen.streak.alreadyMatched ? (
            <p className="mt-1 text-xs text-emerald-800">A match payment is pending or this streak has already been matched.</p>
          ) : (
            <p className="mt-1 text-xs text-slate-600">Four consecutive weeks of allowance savings unlock a parent-funded match.</p>
          )}
        </div>
      )}
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
        <span className="font-semibold text-emerald-900">{ai.model === "offline-demo" ? "✦ Demo assessment" : "✦ Gemini review"}</span>
        <Badge tone={ai.covered ? "green" : "rose"}>{ai.covered ? "Covered" : "Not covered"}</Badge>
        <Badge>{ai.category}</Badge>
        <Badge tone={ai.model === "offline-demo" ? "amber" : "blue"}>{ai.model === "offline-demo" ? "Heuristic estimate" : Math.round(ai.confidence * 100) + "% confident"}</Badge>
        <span className="text-xs text-slate-500">{ai.model}</span>
      </div>
      <p className="mb-2 text-slate-800">{ai.parent_summary}</p>
      <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">AI is advisory only. Check the photo and family rules before making the final decision.</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <Badge tone={ai.model === "offline-demo" ? "amber" : ai.photo_matches_description ? "green" : "rose"}>{ai.model === "offline-demo" ? "Photo not analysed" : ai.photo_matches_description ? "Photo matches description" : "Photo mismatch flagged"}</Badge>
        <Badge tone={ai.risk_flags.length ? "amber" : "green"}>{ai.risk_flags.length ? `${ai.risk_flags.length} risk flag(s)` : "No risk flags"}</Badge>
      </div>
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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    try {
      const r = await api<Claim & { payoutStatus?: string }>("/api/claims/" + claim.id + "/decide", { decision, amount, payee, note });
      onDone(decision === "approve" ? (r.status === "paid" ? `Paid ${amount} via PayPal Payouts (${r.paypal_ref}).` : `Claim approved; PayPal payout status: ${r.payoutStatus || "pending"}.`) : "Claim declined.");
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
          <button type="button" onClick={() => setPhotoOpen(true)} className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" aria-label="Enlarge claim photo">
            <img src={`/api/photos/${claim.id}`} alt="Damage reported in claim" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            <span className="absolute inset-x-0 bottom-0 bg-slate-950/65 px-1 py-1 text-center text-[10px] font-medium text-white">View photo</span>
          </button>
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
      {photoOpen && claim.photo_file && (
        <div role="dialog" aria-modal="true" aria-label="Claim photo preview" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" onClick={() => setPhotoOpen(false)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg" onClick={() => setPhotoOpen(false)}>Close</button>
          <img src={`/api/photos/${claim.id}`} alt="Enlarged claim evidence" className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
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
        <div className="w-full">
          <label className="block text-xs text-slate-500">Note for the family (optional)</label>
          <input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Explain your decision or add a repair instruction" />
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
    streak_bonus_percent: String(r.streak_bonus_percent),
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
        streak_bonus_percent: form.streak_bonus_percent,
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-slate-500">
          Umbrella %<input className={inputCls} value={form.jar_percent} onChange={set("jar_percent")} />
        </label>
        <label className="text-xs text-slate-500">
          Deductible $<input className={inputCls} value={form.deductible} onChange={set("deductible")} />
        </label>
        <label className="text-xs text-slate-500">
          Max payout $<input className={inputCls} value={form.max_payout} onChange={set("max_payout")} />
        </label>
        <label className="text-xs text-slate-500">
          Streak match %<input className={inputCls} value={form.streak_bonus_percent} onChange={set("streak_bonus_percent")} inputMode="numeric" />
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
  const rows = state.ledger.filter((entry) => !memberId || entry.member_id === memberId).slice(0, 100);
  return (
    <Card title="Activity">
      <LedgerGrid entries={rows} names={names} showPerson={!memberId} />
    </Card>
  );
}

function TeenView({ teen, familyId, state, onDone, onError }: { teen: Member; familyId:string; state: AppState } & Handlers) {
  const b = teen.balances!;
  const claims = state.claims.filter((c) => c.member_id === teen.id);
  const [busy, setBusy] = useState(false);
  const [buy, setBuy] = useState({ amount: "", memo: "" });

  async function fileClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const photo = fd.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      onError("Choose a claim photo first.");
      return;
    }
    if (photo.size > 8 * 1024 * 1024) {
      onError("Photo must be under 8 MB.");
      return;
    }
    const extension = photo.type === "image/jpeg" ? ".jpg" : photo.type === "image/png" ? ".png" : photo.type === "image/webp" ? ".webp" : "";
    if (!extension) {
      onError("Use a JPEG, PNG or WebP photo.");
      return;
    }
    setBusy(true);
    try {
      const blob = await upload(`claims/${familyId}/${teen.id}/${crypto.randomUUID()}${extension}`, photo, {
        access: "private",
        handleUploadUrl: "/api/claim-photo/upload",
        clientPayload: JSON.stringify({memberId:teen.id,familyId}),
      });
      fd.delete("photo");
      fd.set("photoPath", blob.pathname);
      await api("/api/claims", fd, true);
      formEl.reset();
      onDone("Claim sent! It has been reviewed and is now with your parent.");
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
    <div className="space-y-5">
      <section aria-label="Your money overview" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">Spending money</p><p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{fmt(b.spend)}</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm"><p className="text-xs font-medium text-emerald-700">Umbrella fund</p><p className="mt-1 text-xl font-semibold tracking-tight text-emerald-900">{fmt(b.jar)}</p></div>
        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-1"><p className="text-xs font-medium text-slate-500">My claims</p><p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{claims.length}</p></div>
      </section>
      <nav aria-label="Teen dashboard sections" className="sticky top-2 z-20 -mx-1 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur sm:mx-0">
        {[["#teen-money","My money"],["#file-claim","File a claim"],["#my-claims","My claims"],["#teen-activity","Activity"],["#money-coach","Money coach"]].map(([href,label]) => <a key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-800">{label}</a>)}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-5 lg:col-span-8">
        <div id="teen-money" className="grid scroll-mt-24 gap-4 sm:grid-cols-2">
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
            <div className="text-sm text-emerald-100">☂️ Umbrella fund</div>
            <div className="text-3xl font-bold">{fmt(b.jar)}</div>
            <p className="mt-3 text-sm text-emerald-50">
              {state.rules.jar_percent}% of every allowance lands here. It covers accidents up to {fmt(state.rules.max_payout_cents)} (you pay the first {fmt(state.rules.deductible_cents)}).
            </p>
          </div>
          {teen.streak && (
            <div className="rounded-2xl border border-emerald-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <strong className="text-sm">Your saving streak</strong>
                <Badge tone={teen.streak.weeks >= 4 ? "green" : "slate"}>{Math.min(teen.streak.weeks, 4)}/4 weeks</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-600">{teen.streak.eligible ? "You've unlocked a parent-funded bonus match. Ask your parent to review it." : "Keep your weekly allowance savings going to unlock a bonus match."}</p>
            </div>
          )}
        </div>

        <div id="file-claim" className="scroll-mt-24"><Card title="Something broke? File a claim">
          <form onSubmit={fileClaim} className="space-y-3">
            <input name="title" className={inputCls} placeholder="e.g. Cracked phone screen" required />
            <textarea name="description" className={`${inputCls} h-24`} placeholder="What happened? Add details so the AI review can help your parent." required />
            <div className="flex flex-wrap gap-3">
              <input name="amount" className={`${inputCls} w-40`} placeholder="Repair cost ($)" inputMode="decimal" required />
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" required />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Gemini is reviewing…" : "Send claim"}</Button>
          </form>
        </Card></div>

        {claims.length > 0 && (
          <div id="my-claims" className="scroll-mt-24"><Card title="My claims">
            <div className="space-y-3">
              {claims.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <strong>{c.title}</strong>
                    {c.status === "pending_parent" && <Badge tone="amber">Waiting for parent</Badge>}
                    {c.status === "paid" && <Badge tone="green">Paid {fmt(c.payout_cents || 0)}</Badge>}
                    {c.status === "payout_pending" && <Badge tone="amber">Payout processing</Badge>}
                    {c.status === "payout_failed" && <Badge tone="rose">Payout failed</Badge>}
                    {c.status === "denied" && <Badge tone="rose">Not covered</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Submitted {new Date(c.created_at.replace(" ", "T") + "Z").toLocaleString()} · Requested {fmt(c.amount_cents)}</p>
                  {c.ai && <div className="mt-2 rounded-lg bg-slate-50 p-3"><p className="text-slate-700">✦ {c.ai.teen_message}</p><p className="mt-1 text-xs text-slate-500">AI estimate: {fmt(c.ai.estimated_repair_cents)} · Suggested support: {fmt(c.ai.final_payout_cents)}</p></div>}
                  {c.payout_cents !== null && <p className="mt-2 text-sm">Approved: <strong>{fmt(c.payout_cents)}</strong></p>}
                  {c.parent_note && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Parent note: {c.parent_note}</p>}
                  {c.paypal_ref && <p className="mt-1 break-all font-mono text-xs text-slate-500">Payment reference: {c.paypal_ref}</p>}
                </div>
              ))}
            </div>
          </Card></div>
        )}
        <div id="teen-activity" className="scroll-mt-24"><Ledger state={state} memberId={teen.id} /></div>
      </div>
      <div id="money-coach" className="scroll-mt-24">
        <Chat
          persona="teen"
          memberId={teen.id}
          title="Jarvis, your money coach"
          intro={`Hey ${teen.name}! Ask me about your umbrella fund, what's covered, or how to save for something.`}
          suggestions={["How much is in my umbrella fund?", "Is a cracked screen covered?", "How long to save $60?"]}
        />
      </div>
      </div>
    </div>
  );
}
