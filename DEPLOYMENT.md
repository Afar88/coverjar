# Paraguas deployment checklist

This guide is for deploying the current SQLite-backed Next.js application without Vercel.

## 1. Choose a compatible host

Use a Node.js application host that supports Next.js and a persistent volume. Configure the service to:

- Install with `npm ci`
- Build with `npm run build`
- Start with `npm run start`
- Use Node.js 22
- Expose the application over HTTPS
- Mount a persistent writable volume and set `DATA_DIR` to its absolute mount path

**Important:** GitHub Pages is not a suitable production host for this repository. It serves static files and cannot execute Next.js API routes, PayPal webhook handlers, Gemini server calls, or SQLite writes.

Keep this version to one running application instance. SQLite is stored on local persistent disk and is not a shared multi-instance database. Before scaling to multiple instances, migrate the database to a managed shared database and move uploaded claim evidence to private object storage.

## 2. Configure secrets

Set these in the hosting provider's environment/secrets settings. Do not put values in GitHub source files.

Required for a production login:
- `PARAGUAS_SESSION_SECRET`: generate a cryptographically random secret of at least 32 characters.
- `PARAGUAS_PARENT_PIN`: private 4–12 digit parent passcode.
- `PARAGUAS_TEEN_PIN`: a different private 4–12 digit teen passcode.

Required for real AI claim review and chat:
- `GEMINI_API_KEY`: create at Google AI Studio.
- Optional: `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS` if you want to override the code defaults.

Required for PayPal sandbox:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT=SANDBOX`
- `PAYPAL_WEBHOOK_ID` after creating the webhook in the PayPal sandbox app

Optional:
- `DEMO_PARENT_EMAIL`
- `DEMO_REPAIR_SHOP_EMAIL`
- `PAYPAL_CRYPTO_ENABLED=false` (keep disabled unless PayPal has explicitly enabled the feature for this merchant)

Set `DATA_DIR` to the persistent volume mount, for example `/var/data/paraguas` if that is the path supplied by your host. The app stores both `paraguas.db` and private claim-photo uploads there. Confirm the directory is writable by the app process.

## 3. Configure PayPal sandbox

1. Create a REST app in PayPal Developer Dashboard under **Sandbox**.
2. Add the app's client ID and secret to the host environment.
3. Create a webhook pointing to `https://YOUR_PUBLIC_HOST/api/paypal/webhook`.
4. Subscribe to:
   - `PAYMENT.SALE.COMPLETED`
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
5. Copy the webhook ID into `PAYPAL_WEBHOOK_ID`.
6. Use sandbox personal accounts for payer and payout recipients.

The webhook ID must belong to the same PayPal REST app/environment as the configured credentials. Do not test recurring allowance credits by relying on the subscription approval redirect: the verified completed-payment webhook is the source of truth.

## 4. Go-live verification

Run these checks in the deployed sandbox environment before switching to live PayPal:

- [ ] App starts successfully and reports the expected provider modes.
- [ ] Parent and teen can sign in with the separate production passcodes.
- [ ] A wrong role cannot access another role's protected actions.
- [ ] A sandbox PayPal top-up credits the exact amount once.
- [ ] Replaying a capture/webhook does not create a duplicate ledger credit.
- [ ] A weekly subscription approval does not credit funds prematurely.
- [ ] A verified `PAYMENT.SALE.COMPLETED` webhook credits the correct allowance split once.
- [ ] Gemini reviews a real test claim photo and returns a structured assessment.
- [ ] A parent can approve/decline; a teen cannot approve or trigger a payout.
- [ ] A sandbox payout reaches the intended test recipient.
- [ ] A pending/ambiguous payout remains reserved and can be reconciled.
- [ ] Restart/redeploy the service and confirm the database and claim photos remain available.
- [ ] Confirm the public webhook endpoint is HTTPS and PayPal can reach it.

## 5. Production switch

Only after all sandbox checks pass:

1. Create a separate PayPal **Live** REST app.
2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` to the live credentials.
3. Set `PAYPAL_ENVIRONMENT=PRODUCTION`.
4. Create a new webhook in the live app and replace `PAYPAL_WEBHOOK_ID` with its live webhook ID.
5. Verify live merchant payout permissions and recipient requirements with PayPal.
6. Run a small, controlled end-to-end payment and payout test before inviting families.

Never mix sandbox credentials with a live webhook ID or the reverse. Do not enable Pay with Crypto unless PayPal has enabled it for the merchant account.

## 6. Operational safeguards

- Keep provider secrets in the host's secret manager.
- Back up the SQLite database and claim uploads together, and test restore procedures.
- Restrict access to backups because they contain family and claim information.
- Monitor application logs for webhook verification failures and payout states; do not log secrets, passcodes, or uploaded image contents.
- Use a shared database and private object storage before adding multiple app instances.
- Keep the app in sandbox mode until the full checklist is complete.
