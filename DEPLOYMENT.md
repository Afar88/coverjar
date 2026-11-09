# Paraguas deployment: Vercel + Neon + private Blob

This branch targets Vercel Functions with Neon PostgreSQL for durable relational data and a **private** Vercel Blob store for claim evidence. SQLite and local-disk uploads are not used by the production application.

## 1. Create the Vercel project

1. Sign in to Vercel with the GitHub account that can access `Afar88/paraguas`.
2. Import the `Afar88/paraguas` repository.
3. Keep `main` as the production branch. Use pull-request branches for Preview deployments and promote only reviewed, passing changes.
4. Keep the framework preset as **Next.js**.
5. Use Node.js 22.
6. Do not configure a static build or static output directory.

Build settings:
- Install: `npm ci`
- Build: `npm run build`
- Output: Vercel default

## 2. Create Neon PostgreSQL

1. In the Vercel project, open **Storage** / **Marketplace** and create or connect a Neon PostgreSQL database.
2. Create a database/branch for Paraguas (use a separate database branch for preview and production where practical).
3. Copy the pooled connection string from Neon. Prefer the pooled hostname (the hostname containing `-pooler`) for serverless application traffic.
4. Confirm Vercel exposes either `DATABASE_URL` or `POSTGRES_URL` in the intended environment. The app accepts both.

The app creates its PostgreSQL tables and indexes on first database access. It seeds the sample family only when the `members` table is empty. Do not point Preview and Production at the same database if you want isolated test data.

## 3. Create a private Vercel Blob store

1. In the Vercel project, open **Storage** and create a Blob store.
2. Choose **Private** access, not Public. Access mode cannot be changed after store creation.
3. Connect the store to the Paraguas Vercel project.
4. Confirm Vercel has added `BLOB_READ_WRITE_TOKEN` to the project's environment variables.

Claim evidence is stored under the `claims/` pathname prefix. The database stores only the opaque Blob pathname and MIME type. The application authenticates every photo read and checks the claim's family-member ownership before retrieving the private Blob.

## 4. Configure application secrets

Add these values under Vercel **Settings → Environment Variables**. Never commit real values to Git.

Required:
- `DATABASE_URL` or `POSTGRES_URL`: pooled Neon PostgreSQL connection string. The app prefers `DATABASE_URL` when both exist and falls back to the Vercel Neon integration's `POSTGRES_URL`.
- `BLOB_READ_WRITE_TOKEN`: token from the private Blob store.
- `PARAGUAS_SESSION_SECRET`: cryptographically random secret with at least 32 characters.
- Parent passwords are selected during family registration and stored as scrypt hashes in Neon.
- Teen PINs are created by the parent for each teen and stored as scrypt hashes in Neon.
- `GEMINI_API_KEY`: Google AI Studio API key.
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT=SANDBOX`
- `PAYPAL_WEBHOOK_ID`: the webhook ID from the same PayPal REST app/environment.

Optional:
- `PARAGUAS_PARENT_PIN` and `PARAGUAS_TEEN_PIN`: legacy single-family/demo login fallback only; new family accounts do not use these shared environment PINs.
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODELS`
- `DEMO_PARENT_EMAIL`
- `DEMO_REPAIR_SHOP_EMAIL`
- `PAYPAL_CRYPTO_ENABLED=false` (keep disabled unless PayPal has enabled Pay with Crypto for this merchant).

Use Vercel's separate Preview and Production environment scopes. Use sandbox PayPal credentials in Preview. Do not add live PayPal credentials until the sandbox checklist is complete.

## 5. Configure PayPal sandbox webhook

Create a PayPal REST webhook pointing to:

`https://YOUR-VERCEL-DOMAIN/api/paypal/webhook`

Subscribe to:
- `PAYMENT.SALE.COMPLETED`
- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.EXPIRED`

Copy the webhook ID to `PAYPAL_WEBHOOK_ID`. The webhook ID must belong to the same REST app and environment as the configured client ID and secret. Recurring allowance credits are issued only after the verified completed-payment webhook; the subscription approval redirect does not credit funds.

## 6. Preview deployment verification

Before promoting a deployment or switching PayPal to Live, verify:

- [ ] Neon connection succeeds and tables/indexes are created.
- [ ] Preview data is isolated from Production data.
- [ ] Parent and teen can sign in using separate production passcodes.
- [ ] Anonymous requests cannot access private family data.
- [ ] Teens cannot view another teen's claims or claim photos.
- [ ] A parent can view family claim evidence through the authenticated photo route.
- [ ] Private Blob URLs do not load without the Blob read token.
- [ ] A fake image renamed as PNG/JPEG/WebP is rejected.
- [ ] A real JPEG, PNG and WebP claim image can be uploaded and read back.
- [ ] A PayPal top-up credits the exact USD amount once.
- [ ] Replayed capture/webhook events do not duplicate ledger credits.
- [ ] Subscription approval alone does not credit allowance.
- [ ] A verified `PAYMENT.SALE.COMPLETED` event credits the right member once.
- [ ] A parent can approve or deny a claim; a teen cannot make parent decisions.
- [ ] A payout timeout remains reserved and can be reconciled without a duplicate transfer.
- [ ] Redeploying the app does not lose database rows or claim photos.
- [ ] Logs contain no secrets, passcodes, or image contents.

## 7. Production cutover

Only after the Preview sandbox checklist passes:

1. Create a separate PayPal Live REST app.
2. Add its Live client ID and secret to the Production environment.
3. Set `PAYPAL_ENVIRONMENT=PRODUCTION`.
4. Create a Live webhook and replace `PAYPAL_WEBHOOK_ID` with its Live webhook ID.
5. Confirm payout permissions and recipient requirements with PayPal.
6. Run a small, controlled payment and payout test.
7. Promote the verified Vercel deployment and invite users.

Never mix sandbox credentials with a live webhook ID or vice versa. Do not enable Pay with Crypto unless PayPal has enabled it for the merchant account.

## 8. Existing SQLite data

This refactor creates a new Neon schema; it does not automatically import an existing SQLite database file. The repository's tracked `data/` directory contains only a placeholder. If a separate deployed or local database contains real family records, stop before cutover and export/import those records using a reviewed migration procedure. Do not assume that a fresh Neon database contains old balances, claims, payment mappings, or payout state.

## 9. Operational notes

- Use Neon pooled connections for Vercel Functions.
- Keep the database connection string and Blob token server-only.
- Back up Neon data and test restore procedures.
- Keep private claim evidence in a Private Blob store; never switch this store to Public.
- Keep Preview and Production environment variables and databases separate.
- Keep PayPal in Sandbox until every end-to-end check passes.
