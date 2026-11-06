# Paraguas ☂️

**Paraguas** (Spanish for “umbrella”) helps families turn a teen's allowance into a small, shared safety net. Parents fund an allowance through PayPal; a percentage is reserved in the family's umbrella fund. If something breaks, the teen files a photo-backed claim, Gemini reviews it against family rules, the parent makes the final decision, and PayPal Payouts can pay the repair shop or parent.

> Paraguas is a family-managed savings pool, not insurance. Funds are not pooled across households and no risk is underwritten.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## How it works

1. **Fund:** A parent makes a one-time PayPal top-up or sets up a weekly PayPal subscription.
2. **Split:** Paraguas atomically divides each confirmed allowance payment between teen spending money and the umbrella fund.
3. **Save:** Four consecutive weeks of positive jar contributions can unlock a configurable, parent-funded saving match.
4. **Claim:** A teen describes the accident and uploads a photo.
5. **Review:** Gemini checks the claim and photo against family rules, estimates repair cost, flags concerns, and writes a parent summary and teen-friendly note.
6. **Protect:** Server-side rules enforce the deductible, maximum payout, and available jar balance. Gemini cannot approve or pay a claim.
7. **Decide and pay:** The parent approves or declines. If approved, PayPal Payouts sends the payment; pending payouts remain reserved until PayPal confirms the outcome.
8. **Coach:** Gemini powers a teen money coach and a parent assistant. The parent assistant can read recent PayPal transactions and subscription status; it does not create or send invoices.

## Technology

- **Next.js 16 / React 19** — server-rendered application and API routes
- **Neon PostgreSQL** via `@neondatabase/serverless` — durable family data, ledger, claims, payment state and idempotency
- **Vercel Blob (Private)** — claim evidence stored privately and streamed only through authenticated routes
- **Google Gemini** via `@ai-sdk/google` and the AI SDK — multimodal claim review and role-aware chat
- **PayPal REST APIs** — Orders, Subscriptions, Payouts, transaction reporting, and webhook signature verification
- **Biome** — linting; **pg-mem** — PostgreSQL-compatible integration test adapter

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

For local development, configure a Neon database and a private Vercel Blob store (use `vercel env pull` to retrieve the Blob token). `DATABASE_URL` is required for login and all database-backed features; `BLOB_READ_WRITE_TOKEN` is required for claim-photo uploads. Gemini and PayPal credentials can be omitted to use the app's simulated/demo provider paths. Local demo passcodes are `2468` (parent) and `1357` (teen); never use them in production.

### Family accounts

Each parent can register their own family from the login screen and gets a family code. Parents sign in with the family code and their password; teens sign in with the family code and the PIN their parent set when adding them. Every family's teens, ledger, claims, rules, payments and AI assistant data are kept separate, and PayPal allowance payments are credited to the paying teen's own family. The shared demo passcodes above still open the built-in demo family.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL pooled connection string |
| `BLOB_READ_WRITE_TOKEN` | Token for the Vercel Blob **Private** store |
| `PARAGUAS_SESSION_SECRET` | Required in production; random secret with at least 32 characters |
| `PARAGUAS_PARENT_PIN` | Parent login passcode; private 4–12 digit value |
| `PARAGUAS_TEEN_PIN` | Teen login passcode; a different private 4–12 digit value |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Optional Gemini model override |
| `GEMINI_FALLBACK_MODELS` | Optional comma-separated Gemini fallback list |
| `PAYPAL_CLIENT_ID` | PayPal REST app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app secret |
| `PAYPAL_ENVIRONMENT` | Set to `SANDBOX` for testing or `PRODUCTION` for live PayPal |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from the matching PayPal REST app |
| `DEMO_PARENT_EMAIL` | Optional seeded parent payout recipient |
| `DEMO_REPAIR_SHOP_EMAIL` | Optional seeded repair-shop payout recipient |
| `PAYPAL_CRYPTO_ENABLED` | Keep disabled unless PayPal has enabled Pay with Crypto for the merchant account |

Never commit `.env.local`, provider secrets, real passcodes, or production data.

## PayPal webhook setup

Recurring allowance payments are credited only after a verified PayPal `PAYMENT.SALE.COMPLETED` webhook. The subscription approval redirect alone does not credit an allowance.

1. Deploy the app to a public HTTPS Vercel URL.
2. In the PayPal REST app, register `https://YOUR_HOST/api/paypal/webhook`.
3. Subscribe to `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, and `BILLING.SUBSCRIPTION.EXPIRED`.
4. Save the webhook ID as `PAYPAL_WEBHOOK_ID` in the same environment as the matching PayPal credentials.
5. Send a sandbox event and confirm the handler verifies it and credits the ledger once.

## Deployment

Paraguas is a server-rendered Next.js application and must not be deployed as a static site. The target hosting architecture is:

- **Vercel** for Next.js and API routes
- **Neon PostgreSQL** for durable relational storage
- **Vercel Blob Private** for claim evidence

See [DEPLOYMENT.md](DEPLOYMENT.md) for setup, environment variables, webhook configuration, preview verification, and production cutover.

## Existing SQLite data

The Neon schema is initialized automatically on first database access. The migration does **not** automatically import an external SQLite database file. The tracked repository `data/` directory contains only a placeholder. If another deployed environment contains real family data, balances, claims, subscriptions, payment references, or payout state, do not cut over until those records have been exported and imported through a reviewed migration.

## Security and payment integrity

- Signed, HTTP-only parent/teen sessions; server routes enforce role permissions.
- Login and claim-submission rate limits.
- Claim uploads validate JPEG/PNG/WebP signatures and are stored in a private Blob store.
- Photo reads check session role and claim ownership before fetching the private Blob.
- Payment settlement checks exact USD amounts and uses idempotency to prevent duplicate credits or payouts.
- PayPal webhook signatures are verified before recurring credits are applied.
- Parent approval is required before claim payouts; ambiguous payout outcomes remain reserved and can be reconciled.
- Family payout caps are enforced in server code, independently of Gemini output.
- CI runs PostgreSQL adapter tests, lint, TypeScript checks, production build, and a full dependency audit.

## Demo walkthrough

1. Sign in as parent.
2. Top up a teen's allowance and observe the spending/jar split.
3. Sign in as the teen and submit a damage claim with a photo.
4. Return to the parent view, inspect the assessment, then approve or decline.
5. Explore the teen money coach and parent assistant.

For a hackathon demonstration, clearly identify simulated provider activity whenever sandbox credentials are not configured.

## License

[MIT](LICENSE)
