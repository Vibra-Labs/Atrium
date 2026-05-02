# Testing Stripe Connect Invoice Payments

Step-by-step instructions to manually test the full Stripe Connect payment flow locally.

## Prerequisites

- Atrium running locally (`bun run dev`)
- A [Stripe account](https://dashboard.stripe.com/register) (free to create)
- A second Stripe account to act as the "connected agency" (or use the same one in test mode)

## 1. Stripe Dashboard Setup

### Create a Connect Platform

1. Go to [Stripe Dashboard > Connect > Settings](https://dashboard.stripe.com/test/settings/connect)
2. Complete the platform profile if prompted (select "Other" for platform type)
3. Under **Integration**, find your **Test mode client ID** — it looks like `ca_xxxxxxxx`
4. Under **Redirects**, add your callback URL:
   ```
   http://localhost:3001/api/payments/connect/callback
   ```

### Set Up the Connect Webhook

1. Go to [Stripe Dashboard > Developers > Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click **Add endpoint**
3. For local testing, you need to use the Stripe CLI to forward webhooks (see step 2 below)
4. Select these events:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `account.application.deauthorized`

### Configure Environment

Add to your `.env` file:

```bash
STRIPE_CONNECT_CLIENT_ID="ca_xxxxxxxxxxxxx"    # From Connect Settings
STRIPE_CONNECT_WEBHOOK_SECRET=""               # Will be set in step 2
# STRIPE_CURRENCY="usd"                        # Optional, defaults to usd
```

## 2. Forward Webhooks Locally (Stripe CLI)

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) if you haven't:

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

Forward Connect webhooks to your local server:

```bash
stripe listen --forward-connect-to localhost:3001/api/payments/webhook
```

The CLI will print a webhook signing secret like `whsec_xxxxx`. Copy it into your `.env`:

```bash
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"
```

Restart the API server after updating `.env`.

## 3. Test the Agency Owner Flow

### Connect Stripe Account

1. Log in as the **org owner** at `http://localhost:3000/login`
2. Go to **Settings > Payments** (`/dashboard/settings/payments`)
3. Find the **Client Payments** section
4. Click **Connect with Stripe** (purple button)
5. You'll be redirected to Stripe's OAuth page
6. Click **Skip this form** (test mode) or connect a real test account
7. You should be redirected back to Settings with a green "Connected" badge
8. The badge should show "Test mode" with a yellow warning

### Verify Connected State

- The status should show "Connected" with a masked account ID
- A yellow message should say "Clients cannot submit real payments in test mode..."
- A "Disconnect Stripe" button should be visible

### Test Cancel Flow

1. Click **Disconnect Stripe** to reset
2. Click **Connect with Stripe** again
3. On the Stripe OAuth page, click the browser back button or close the tab
4. Return to Settings — you should see an info toast about cancellation

## 4. Test the Client Payment Flow

### Setup: Create a Payable Invoice

1. As the **owner**, go to a project (`/dashboard/projects/[id]`)
2. Click the **Invoices** tab
3. Click **New Invoice** and create one with at least one line item (e.g., "Consulting - 1x $100")
4. Click **Create Invoice**
5. Expand the invoice and click **Mark as Sent**
6. Make sure a client is assigned to this project (Clients tab > Add Client)

### Pay as a Client

1. Log in as the **client user** (or use a separate browser/incognito)
2. Go to the portal (`/portal/projects/[id]`)
3. In the Invoices section, you should see:
   - A compact **Pay** button on the invoice row (right side, next to status badge)
   - The invoice status should be "sent"
4. Click **Pay** (or expand and click **Pay Now**)
5. You'll be redirected to Stripe Checkout
6. Use test card: `4242 4242 4242 4242`, any future expiry, any CVC
7. Complete the payment
8. You should be redirected back to the portal with:
   - A success toast: "Payment successful!"
   - The invoice status updated to "paid"

### Verify Payment on Dashboard

1. Log back in as the **owner**
2. Go to the project's Invoices tab
3. The invoice should now show "paid" status
4. Expand it — you should see a green bar: "Paid via Stripe" with the payment date
5. The **Delete** button should be hidden for this invoice
6. The **Mark as Paid** button should not appear (it was paid via Stripe)

### Verify Notifications

1. Check the owner's notification bell — should have "Invoice INV-XXXX paid"
2. Check the Stripe CLI terminal — should show the webhook event was received
3. If email is configured, check for the "Payment Received" email

## 5. Test Edge Cases

### Cancel Payment Mid-Checkout

1. Create and send another invoice
2. As the client, click **Pay**
3. On the Stripe Checkout page, click the back arrow or close the tab
4. Return to the portal — you should see an info toast: "Payment was not completed..."
5. The invoice should still show "sent" — click Pay again to verify it works

### Overdue Invoice Payment

1. Create an invoice with a past due date
2. Wait for the overdue cron to run (hourly), or manually mark it:
   ```bash
   # Mark overdue via API
   curl -X PUT http://localhost:3001/api/invoices/[id] \
     -H "Content-Type: application/json" \
     -H "Cookie: [your-session-cookie]" \
     -d '{"status": "overdue"}'
   ```
3. As the client, verify the "Pay" button still appears on overdue invoices
4. Complete the payment and verify it transitions to "paid"

### Stripe-Paid Invoice Protection

1. Try to delete a Stripe-paid invoice from the dashboard
2. The Delete button should not be visible
3. If you hit the API directly, you should get a 400 error:
   ```
   "Cannot delete an invoice that was paid via Stripe."
   ```

### Disconnect Stripe (External)

1. Go to [Stripe Dashboard > Connect > Connected Accounts](https://dashboard.stripe.com/test/connect/accounts/overview)
2. Find the connected test account and remove/revoke it
3. The webhook should fire `account.application.deauthorized`
4. Check the owner's notifications — should see "Stripe account disconnected"
5. Refresh the Settings page — should show "Connect with Stripe" again

### Payment Instructions Visibility

1. Go to Settings and add manual Payment Instructions (bank transfer info, etc.)
2. As a client, expand a **sent** invoice — payment instructions should be visible
3. Expand a **paid** invoice — payment instructions should NOT be visible

## 6. Run Automated Tests

```bash
# Unit tests
bun run test

# E2E tests (includes invoice-payments.e2e.ts)
bun run test:e2e
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Stripe Connect is not configured" | Set `STRIPE_CONNECT_CLIENT_ID` in `.env` and restart |
| Webhook events not received | Make sure `stripe listen` is running and `STRIPE_CONNECT_WEBHOOK_SECRET` matches |
| OAuth callback returns 403 | Make sure callback URL is added in Stripe Dashboard > Connect > Redirects |
| "URL must be on the application domain" | Ensure `WEB_URL` in `.env` matches the origin you're testing from |
| Invoice stays "sent" after payment | Check `stripe listen` output for errors; verify webhook secret |
