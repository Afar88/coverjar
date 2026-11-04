"use client";
import { useEffect, useRef, useState } from "react";
import { api, Button } from "./ui";

type Settled = { split?: { spend: number; jar: number } };
const splitMsg = (prefix: string, r: Settled) =>
  r.split ? (r.split.spend === 0 ? `${prefix} $${(r.split.jar / 100).toFixed(2)} added to the jar.` : `${prefix} $${(r.split.spend / 100).toFixed(2)} to spending, $${(r.split.jar / 100).toFixed(2)} to the jar.`) : `${prefix} Already credited.`;

type PayPalSDK = {
  Buttons: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError: (err: unknown) => void;
    onCancel?: () => Promise<void>;
  }) => { render: (el: HTMLElement) => Promise<void>; close: () => void };
};

declare global {
  interface Window {
    paypal?: PayPalSDK;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(clientId: string) {
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load PayPal"));
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export function TopUp({
  memberId,
  amount,
  clientId,
  cryptoEnabled,
  onDone,
  onError,
  purpose = "allowance",
}: {
  memberId: string;
  amount: string;
  clientId: string | null;
  cryptoEnabled: boolean;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
  purpose?: "allowance" | "streak_bonus";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const amountRef = useRef(amount);
  useEffect(() => {
    amountRef.current = amount;
  }, [amount]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let buttons: { close: () => void } | null = null;
    const el = ref.current;
    let activeOrderId: string | null = null;
    loadSdk(clientId)
      .then(() => {
        if (!window.paypal) return;
        const b = window.paypal.Buttons({
          style: { layout: "horizontal", height: 40, tagline: false, label: "pay" },
          createOrder: async () => {
            const order = await api<{ id: string }>("/api/topup/create", { memberId, amount: amountRef.current, method: purpose === "streak_bonus" ? "streak_bonus" : undefined });
            activeOrderId = order.id;
            return order.id;
          },
          onApprove: async ({ orderID }) => {
            onDone(splitMsg("Paid with PayPal.", await api<Settled>("/api/topup/capture", { orderId: orderID })));
          },
          onError: (err) => onError(String((err as Error)?.message || err)),
          onCancel: async () => {
            if (purpose === "streak_bonus" && activeOrderId) await api("/api/topup/cancel", { orderId: activeOrderId });
          },
        });
        buttons = b;
        b.render(el);
      })
      .catch((e) => onError(e.message));
    return () => buttons?.close();
  }, [clientId, memberId, onDone, onError, purpose]);

  async function simulate() {
    setBusy(true);
    try {
      const o = await api<{ id: string }>("/api/topup/create", { memberId, amount, method: purpose === "streak_bonus" ? "streak_bonus" : undefined });
      onDone(splitMsg("Simulated PayPal payment.", await api<Settled>("/api/topup/capture", { orderId: o.id })));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function payCrypto() {
    setBusy(true);
    try {
      const o = await api<{ approveUrl: string | null }>("/api/topup/create", { memberId, amount, method: "crypto" });
      if (o.approveUrl) window.location.href = o.approveUrl;
      else onError("PayPal did not return a crypto approval link");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {clientId ? <div ref={ref} className="min-h-10" /> : <Button onClick={simulate} disabled={busy}>{purpose === "streak_bonus" ? "Fund saving-streak match (simulated)" : "Pay with PayPal (simulated)"}</Button>}
      {cryptoEnabled && purpose === "allowance" && (
        <Button variant="secondary" onClick={payCrypto} disabled={busy}>
          Pay with crypto (PYUSD)
        </Button>
      )}
    </div>
  );
}
