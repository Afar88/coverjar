# CoverJar

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**An allowance that protects itself.** Parents fund a teen's weekly allowance through PayPal. A share of every allowance lands in a family‑funded *protection jar*. When something breaks, the teen files a claim with a photo, **Gemini** reviews it against the family's rules, the parent approves in one tap, and **PayPal Payouts** pays the repair shop.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

> CoverJar is a self‑funded family savings pool, not an insurance product. No premiums are pooled across households and no risk is underwritten.

## Why

Teens break phones, bikes and headphones. Parents usually pay, and the teen learns nothing about risk. Insurance for teens doesn't exist at this scale, and kids can't hold PayPal accounts. CoverJar gives families a tiny, transparent "insurance" they run themselves, and turns every accident into a money lesson.

## How it works

| Step | What happens | Tech |
|---|---|---|
| Fund | Parent tops up or automates the weekly allowance | PayPal Orders v2 (JS SDK buttons), PayPal Subscriptions, optional **Pay with Crypto (PYUSD)** |
| Split | `jar_percent` of each payment goes to the protection jar, the rest to spending money | SQLite ledger |
| Claim | Teen describes what broke and uploads a photo | Gemini multimodal + structured output |
| Review | Gemini checks coverage rules, inspects the photo, flags risks, estimates repair cost and writes a parent summary + a teen‑friendly coaching note | `generateObject` with a Zod schema |
| Guardrails | Code enforces deductible, max payout and jar balance, regardless of what the model says | `applyFamilyCaps` |
| Approve | Parent approves (or edits the amount) and picks the payee | PayPal Payouts |
| Coach | Teen chats with "Jarvis" about their jar and saving; parent assistant can look up PayPal transactions, subscriptions and invoices and change jar rules | Gemini tool calling + **PayPal Agent Toolkit** |

## AI tools used

- **Google Gemini** (`gemini-3.8-flash` by default, override with `GEMINI_MODEL`) through the Vercel AI SDK (`@ai-sdk/google`):
  - claim review from text + photo with a strict JSON schema (`src/lib/gemini.ts`)
  - teen money coach and parent assistant with tool calling (`src/app/api/chat/route.ts`)
- **PayPal Agent Toolkit** (`@paypal/agent-toolkit/ai-sdk`) gives the parent assistant real PayPal tools (transactions, orders, invoices, subscriptions, products).
- Devin (Cognition) was used as a coding assistant during development.

## Run it locally

Requires Node 20+ (tested on Node 22).

```bash
git clone https://github.com/Afar88/coverjar.git
cd coverjar
npm install
cp .env.example .env.local   # optional: add keys
npm run dev                  # http://localhost:3000
```

**No keys? It still works.** Without `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` payments are simulated (IDs prefixed `MOCK-`), and without `GEMINI_API_KEY` claims use a rule‑based fallback and chat is disabled. The header badges show which mode you're in.

### Keys

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | https://developer.paypal.com → Apps & Credentials → **Sandbox** → Create App |
| `DEMO_PARENT_EMAIL`, `DEMO_REPAIR_SHOP_EMAIL` | Sandbox personal account emails (Testing Tools → Sandbox Accounts) to receive payouts |
| `PAYPAL_CRYPTO_ENABLED=true` | Only after PayPal enables Pay with Crypto for your US merchant account |

Data lives in `data/coverjar.db` (seeded with a demo family on first run). Delete it to reset.

## Demo script

1. **Ada (parent)**: top up Tobi's allowance with PayPal. Watch 20% land in his jar.
2. **Tobi (teen)**: file "Cracked phone screen" with a photo. Gemini reviews it.
3. **Ada**: read Gemini's summary and risk flags, approve, and pay the repair shop via PayPal Payouts.
4. **Tobi**: ask Jarvis "how long until my jar is full again?"
5. **Ada**: ask the assistant "show recent PayPal transactions" or "raise the jar share to 25%".

## Project layout

```
src/lib/db.ts          SQLite schema, seed data, ledger helpers
src/lib/paypal.ts      Orders, capture, Payouts, Subscriptions, Agent Toolkit
src/lib/gemini.ts      Claim assessment schema, Gemini call, family caps
src/app/api/*          Route handlers (top-up, claims, decide, chat, rules…)
src/components/*       Parent and teen UI
```

## License

[MIT](LICENSE)
