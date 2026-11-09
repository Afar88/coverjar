"use client";
import { useState } from "react";
import { api, Button, Card, inputCls } from "./ui";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

export function Chat({ persona, memberId, title, intro, suggestions }: { persona: "parent" | "teen"; memberId?: string; title: string; intro: string; suggestions: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ text: string; tools: string[] }>("/api/chat", {
        role: persona,
        memberId,
        messages: next.map(({ role, content }) => ({ role, content })),
      });
      setMessages([...next, { role: "assistant", content: r.text || "(no reply)", tools: r.tools }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Sorry, something went wrong: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={title}>
      <div className="mb-3 max-h-80 space-y-3 overflow-y-auto" aria-live="polite" aria-relevant="additions">
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{intro}</p>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-800"}`}>
              {m.content}
            </div>
            {m.tools && m.tools.length > 0 && <div className="mt-1 text-xs text-slate-500">Used: {m.tools.join(", ")}</div>}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500" role="status"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Thinking…</div>}
      </div>
      {messages.length === 0 && suggestions.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor="assistant-message">Message the assistant</label>\n        <input id="assistant-message" className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" autoComplete="off" />
        <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
      </form>
    </Card>
  );
}
