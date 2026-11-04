# Paraguas ☂️

***Paraguas*** **is Spanish for "umbrella."** An umbrella covers you on a rainy day. Paraguas does the same for kids: a small part of every allowance becomes an *umbrella fund* that covers them when "it rains": a cracked phone screen, a broken bike, snapped headphones.

| Rainy day | Paraguas |
|---|---|
| ☔ It starts raining | Something breaks (an accident) |
| ☂️ The umbrella | The umbrella fund, built from a share of each allowance the parent pays through PayPal |
| Opening the umbrella | The teen files a claim with a photo and **Gemini** reviews it |
| Staying dry | The parent approves and **PayPal Payouts** pays for the repair |

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**An allowance that protects itself.** Parents fund a teen's weekly allowance through PayPal. A share of every allowance lands in a family‑funded *umbrella fund*. When something breaks, the teen files a claim with a photo, **Gemini** reviews it against the family's rules, the parent approves in one tap, and **PayPal Payouts** pays the repair shop.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

> Paraguas is a self‑funded family savings pool, not an insurance product. No premiums are pooled across households and no risk is underwritten.

## Why

Teens break phones, bikes and headphones. Parents usually pay, and the teen learns nothing about risk. Insurance for teens doesn't exist at this scale, and kids can't hold PayPal accounts. Paraguas gives families a tiny, transparent "insurance" they run themselves, and turns every accident into a money lesson.

## How it works

| Step | What happens | Tech |
|---|---|---|
| Fund | Parent tops up or automates the weekly allowance | PayPal Orders v2 (JS SDK buttons), PayPal Subscriptions, optional **Pay with Crypto (PYUSD)** |
| Split | `jar_percent` of each allowance goes to the umbrella fund, the rest to spending money | SQLite ledger |
| Reward | Four consecutive weeks of allowance saving unlock a configurable parent-funded match; PayPal payment goes directly into the jar | PayPal Orders + idempotent SQLite ledger |
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
git clone https://github.com/Afar88/paraguas.git
cd paraguas
npm install
cp .env.example .env.local   # optional: add keys
npm run dev                  # http://localhost:3000
```

**No keys? It still works.** In local development, use parent passcode `2468` or teen passcode `1357`. Set `PARAGUAS_PARENT_PIN`, `PARAGUAS_TEEN_PIN`, and a long random `PARAGUAS_SESSION_SECRET` before production; production refuses the development defaults. Parent and teen sessions are signed, HTTP-only cookies, and server routes enforce each role. Without `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` payments are simulated (IDs prefixed `MOCK-`), and without `GEMINI_API_KEY` claims use a rule‑based fallback and chat is disabled. The header badges show which mode you're in.

### Keys

| Variable | Where to get it |
|---|---|
| `PARAGUAS_SESSION_SECRET`, `PARAGUAS_PARENT_PIN`, `PARAGUAS_TEEN_PIN` | Set your own long random session secret and separate 4–12 digit passcodes before deployment. Never commit `.env.local`. |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | https://developer.paypal.com → Apps & Credentials → **Sandbox** → Create App |
| `PAYPAL_WEBHOOK_ID` | Webhook ID shown after adding `https://YOUR_PUBLIC_HOST/api/paypal/webhook` to that Sandbox app. Subscribe to `PAYMENT.SALE.COMPLETED`. |
| `DEMO_PARENT_EMAIL`, `DEMO_REPAIR_SHOP_EMAIL` | Sandbox personal account emails (Testing Tools → Sandbox Accounts) to receive payouts |
| `PAYPAL_CRYPTO_ENABLED=true` | Only after PayPal enables Pay with Crypto for your US merchant account |

Data lives in `data/paraguas.db` (seeded with a demo family on first run). Delete it to reset.

### Recurring allowance payments

The subscription approval redirect does **not** credit an allowance. A verified PayPal `PAYMENT.SALE.COMPLETED` webhook is the source of truth for each billing cycle. The webhook handler maps the PayPal subscription to the teen, checks the paid amount, and credits the spending balance + umbrella-fund share in one SQLite transaction. PayPal event IDs and sale IDs are recorded to prevent duplicate credits when PayPal retries delivery.

To connect it:

1. Run Paraguas on a publicly reachable HTTPS host (or expose local development through a secure HTTPS tunnel).
2. In the PayPal REST app settings, add the webhook URL: `https://YOUR_HOST/api/paypal/webhook`.
3. Subscribe to `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, and `BILLING.SUBSCRIPTION.EXPIRED`.
4. Copy the generated webhook ID into `PAYPAL_WEBHOOK_ID` in `.env.local`, then restart the app.

The app verifies each webhook with PayPal before processing it. A saving-streak match is a separate parent-funded PayPal payment, not newly created or simulated family money; the match is credited to the jar only after capture confirmation. Four consecutive calendar weeks with positive allowance-to-jar deposits are required, and the configurable match percentage is applied to those four weeks of jar contributions. If verification or processing fails, the endpoint returns a non-2xx response so PayPal can retry. The no-credentials demo uses a clearly simulated one-time subscription settlement and does not need a webhook.

## Demo script

1. **Ada (parent)**: top up Tobi's allowance with PayPal. Watch 20% land in his jar.
2. **Tobi (teen)**: file "Cracked phone screen" with a photo. Gemini reviews it.
3. **Ada**: read Gemini's summary and risk flags, approve, and pay the repair shop via PayPal Payouts.
4. **Ada**: optionally fund the saving-streak match after four consecutive weekly allowance deposits. The match is calculated from the last four weeks of jar contributions and only credited after PayPal confirms payment.
5. **Tobi**: ask Jarvis "how long until my jar is full again?"
6. **Ada**: ask the assistant "show recent PayPal transactions" or "raise the jar share to 25%".

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

### Claim photo safety and payout tracking

Claim evidence accepts JPEG, PNG and WebP images up to 8 MB. The server checks the file signature instead of trusting the filename or browser MIME label, stores it under a generated filename, and serves it only to the parent or the teen who filed that claim.

If a PayPal claim payout is still processing or the initial response times out, Paraguas keeps the amount reserved in the umbrella fund. The parent can use **Check PayPal payout status** in the claim history to query the existing payout batch. If the batch reference was lost during a timeout, Paraguas replays the same idempotent PayPal request to recover the original batch rather than creating a second transfer. Funds are released only after PayPal reports a terminal failed outcome; a payout is marked paid only after both the batch and payout item report success.
