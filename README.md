# Paraguas ☂️

**Paraguas** (Spanish for “umbrella”) helps families turn a teen's allowance into a small, shared safety net. Parents fund an allowance through PayPal; a percentage is reserved in the family's umbrella fund. If something breaks, the teen files a photo-backed claim, Gemini reviews it against family rules, the parent makes the final decision, and PayPal Payouts can pay the repair shop or parent.

> Paraguas is a family-managed savings pool, not insurance. Funds are not pooled across households and no risk is underwritten.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## How it works

1. **Fund:** A parent makes a one-time PayPal top-up or sets up a weekly PayPal subscription.
2. **Split:** Paraguas atomically divides each confirmed allowance payment between teen spending money and the umbrella fund.
3. **Save:** Four consecutive weeks of positive jar contributions can unlock a configurable, parent-funded saving match.
4. **Claim:** A teen describes the accident and uploads a photo.
5. **Review:** Gemini checks the claim and photo against the family's rules, estimates repair cost, flags concerns, and writes a parent summary and teen-friendly note.
6. **Protect:** Server-side rules enforce the deductible, maximum payout, and available jar balance. Gemini cannot approve or pay a claim.
7. **Decide and pay:** The parent approves or declines. If approved, PayPal Payouts sends the payment; pending payouts remain reserved until PayPal confirms the outcome.
8. **Coach:** Gemini powers a teen money coach and a parent assistant. The parent assistant can read recent PayPal transactions and subscription status; it does not create or send invoices.

## Technology

- **Next.js 16 / React 19** — application and server-side API routes
- **Google Gemini** via `@ai-sdk/google` and the AI SDK — multimodal claim review and role-aware chat
- **PayPal REST APIs** — Orders, Subscriptions, Payouts, transaction reporting, and webhook signature verification
- **SQLite** via `better-sqlite3` — family data, ledger, claims, idempotency records, and payment state
- **Biome** — linting

## Run locally

Requires Node.js 22.

```bash
git clone https://github.com/Afar88/paraguas.git
cd paraguas
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

With no provider keys, the app runs in clearly labelled demo mode: parent passcode `2468`, teen passcode `1357`, simulated PayPal payments, and rule-based claim assessments. These are local demo credentials only. Production rejects the development defaults.

## Environment variables

| Variable | Purpose |
|---|---|
| `PARAGUAS_SESSION_SECRET` | Required in production; use a random secret with at least 32 characters |
| `PARAGUAS_PARENT_PIN` | Parent login passcode; set a private 4–12 digit value |
| `PARAGUAS_TEEN_PIN` | Teen login passcode; set a different private 4–12 digit value |
| `DATA_DIR` | Optional absolute path for the SQLite database and private claim-photo uploads; must be on persistent storage in production |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Optional Gemini model override |
| `GEMINI_FALLBACK_MODELS` | Optional comma-separated model fallback list |
| `PAYPAL_CLIENT_ID` | PayPal REST app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app secret |
| `PAYPAL_ENVIRONMENT` | Set to `SANDBOX` for testing or `PRODUCTION` for live PayPal |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from the matching PayPal REST app |
| `DEMO_PARENT_EMAIL` | Optional seeded parent payout recipient for demo/testing |
| `DEMO_REPAIR_SHOP_EMAIL` | Optional seeded repair-shop payout recipient for demo/testing |
| `PAYPAL_CRYPTO_ENABLED` | Keep disabled unless PayPal has enabled Pay with Crypto for the merchant account |

Never commit `.env.local`, provider secrets, real passcodes, or production data.

## PayPal webhook setup

Recurring allowance payments are credited only after a verified PayPal `PAYMENT.SALE.COMPLETED` webhook. The subscription approval redirect alone does not credit an allowance.

1. Deploy the app to a public HTTPS host.
2. In the PayPal REST app, register `https://YOUR_HOST/api/paypal/webhook`.
3. Subscribe to `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, and `BILLING.SUBSCRIPTION.EXPIRED`.
4. Save the webhook ID as `PAYPAL_WEBHOOK_ID` in the same environment as the matching PayPal credentials.
5. Send a sandbox event and confirm the webhook returns successfully and the ledger records the payment once.

The handler verifies the signature with PayPal and records event/sale IDs to prevent duplicate credits when PayPal retries delivery.

## Production hosting requirements

Paraguas is a **server-rendered Next.js application**, not a static website. GitHub Pages alone cannot run its API routes, PayPal webhooks, Gemini requests, or SQLite database.

Deploy it to a Node.js host that supports:
- Next.js production builds and a long-running Node server
- A persistent writable disk/volume mounted at an absolute path (set `DATA_DIR` to that mount)
- HTTPS and a stable public URL for PayPal webhooks
- Environment variables/secrets
- A single application instance for this SQLite-backed version, or a deliberate migration to a shared database before horizontal scaling

The SQLite database and private claim uploads are both stored under `DATA_DIR`. Ephemeral server storage will lose family data and claim photos on restart/redeploy. Do not use a static-only host or an ephemeral filesystem for production.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the deployment and go-live checklist.

## Security and payment integrity

- Signed, HTTP-only parent/teen sessions; server routes enforce role permissions.
- Login and claim-submission rate limits.
- Claim uploads validate actual image signatures, allow JPEG/PNG/WebP up to 8 MB, and are served privately.
- Payment settlement checks amounts/currencies and uses idempotency to prevent duplicate credits or payouts.
- PayPal webhook signatures are verified before recurring credits are applied.
- Parent approval is required before claim payouts; ambiguous payout outcomes remain pending and can be reconciled.
- Family payout caps are enforced in server code, independently of Gemini output.
- CI runs tests, Biome lint, TypeScript checks, production build, and a full dependency audit.

## Demo walkthrough

1. Sign in as parent using the local demo passcode.
2. Top up a teen's allowance and observe the spending/jar split.
3. Sign in as the teen and submit a damage claim with a photo.
4. Return to the parent view, inspect the assessment, then approve or decline.
5. Explore the teen money coach and parent assistant.

For a hackathon demonstration, clearly identify simulated provider activity whenever sandbox credentials are not configured.

## License

[MIT](LICENSE)
