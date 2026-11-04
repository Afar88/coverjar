"use client";
import { useState } from "react";
import { api, Button, Card, inputCls } from "./ui";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

export function Chat({ role, memberId, title, intro, suggestions }: { role: "parent" | "teen"; memberId?: string; title: string; intro: string; suggestions: string[] }) {
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
        role,
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
      <div className="mb-3 max-h-80 space-y-3 overflow-y-auto">
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{intro}</p>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-800"}`}>
              {m.content}
            </div>
            {m.tools && m.tools.length > 0 && <div className="mt-1 text-xs text-slate-500">Used: {m.tools.join(", ")}</div>}
          </div>
        ))}
        {busy && <div className="text-sm text-slate-500">Thinking…</div>}
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {messages.length === 0 &&
          suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
              {s}
            </button>
          ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" />
        <Button type="submit" disabled={busy}>Send</Button>
      </form>
    </Card>
  );
}
