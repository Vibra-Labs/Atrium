# Stripe Setup

Atrium supports two modes for client invoice payments via Stripe. Choose the one that fits your setup:

| Mode | Best for |
|------|----------|
| **Direct Keys** | Simplest setup — paste your Stripe secret key directly into Settings |
| **Connect** | Connect your Stripe account via OAuth instead of sharing a secret key |

---

## Direct Keys Mode

This is the simplest setup. Each agency enters their own Stripe secret key directly in Atrium's settings.

### 1. Get your Stripe secret key

Go to [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys) (test) or the live equivalent and copy your **Secret key** (`sk_test_...` or `sk_live_...`).

### 2. Set your API URL

Stripe needs to reach your Atrium instance to deliver webhook events. Set `API_URL` in your `.env` to your public HTTPS URL:

```env
API_URL="https://your-atrium-domain.com"
```

> **Local dev:** Stripe cannot reach `localhost`. Use a tunnel like [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) or [ngrok](https://ngrok.com) and set `API_URL` to the tunnel URL before entering your key in settings.

### 3. Enter the key in Atrium

1. Log in as an owner
2. Go to **Settings → Payments**
3. Enter your Stripe secret key and save

Atrium will automatically register a webhook endpoint on your Stripe account and store the signing secret. No manual webhook setup needed.

### Environment variables (Direct Keys)

No Stripe-specific env vars are required for Direct Keys mode. Only `API_URL` must be set to a publicly accessible HTTPS URL.

---

## Connect Mode

Connect mode lets you link your Stripe account to Atrium via OAuth instead of pasting a secret key. This uses Stripe Connect's Standard OAuth flow.

### 1. Create a Stripe Connect platform

1. Go to [dashboard.stripe.com/settings/connect](https://dashboard.stripe.com/settings/connect)
2. Complete the platform profile if prompted
3. Copy your **Client ID** — it starts with `ca_`

### 2. Add the OAuth redirect URL

In the same Connect settings page, under **Redirects**, add:

```
https://your-atrium-domain.com/api/payments/connect/callback
```

### 3. Create a webhook endpoint

Go to **Developers → Webhooks** and create a new endpoint:

- **URL:** `https://your-atrium-domain.com/api/payments/webhook`
- **Events to listen for:**
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `account.application.deauthorized`
- **Important:** Enable **"Listen to events on Connected accounts"** on the endpoint

After creating the webhook, copy the **Signing secret** (`whsec_...`).

### 4. Set environment variables

```env
STRIPE_MODE="test"                         # or "live"
STRIPE_TEST_SECRET_KEY="sk_test_..."       # Platform's own Stripe secret key
STRIPE_CONNECT_CLIENT_ID="ca_..."          # From Connect settings
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_..." # From the webhook you created
STRIPE_CURRENCY="usd"                      # ISO 4217 currency code
```

> For live mode, set `STRIPE_MODE="live"` and use `STRIPE_LIVE_SECRET_KEY` instead of `STRIPE_TEST_SECRET_KEY`.

### 5. Connect a Stripe account

Once deployed with the above env vars, go to **Settings → Payments** and click **Connect with Stripe**. This starts the OAuth flow. After completing it, your Stripe account is connected and clients can pay invoices.

---

## Local Development

### Direct Keys (local)

Use a tunnel to expose your local API:

```bash
# cloudflared (no account needed)
cloudflared tunnel --url http://localhost:3001

# or ngrok
ngrok http 3001
```

Set `API_URL` to the tunnel URL in your `.env`, then enter your Stripe key in Settings. The webhook will be registered automatically pointing to the tunnel.

### Connect Mode (local)

Use the Stripe CLI to forward webhook events to localhost:

```bash
# Install
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward Connect events
stripe listen \
  --forward-connect-to http://localhost:3001/api/payments/webhook \
  --events checkout.session.completed,checkout.session.expired,account.application.deauthorized
```

The CLI will print a `whsec_...` signing secret. Use that as `STRIPE_CONNECT_WEBHOOK_SECRET` in your `.env`. Keep the CLI running while testing.

---

## Currency

Set `STRIPE_CURRENCY` to any [ISO 4217](https://en.wikipedia.org/wiki/ISO_4217) lowercase currency code. Defaults to `usd`.

```env
STRIPE_CURRENCY="eur"
```

This applies to all invoices across the platform.

---

## Troubleshooting

**Invoice paid but still shows as overdue**

The webhook did not fire or failed verification. Check:
1. **Stripe Dashboard → Developers → Webhooks → your endpoint → Recent deliveries** — look for failed events
2. In Connect mode, confirm the endpoint has **"Listen to events on Connected accounts"** enabled
3. Verify `STRIPE_CONNECT_WEBHOOK_SECRET` matches the signing secret shown in the Stripe dashboard

**"Failed to register webhook on your Stripe account"** (Direct Keys)

Your `API_URL` is not publicly accessible from Stripe's servers. Make sure it points to an HTTPS URL reachable from the internet, not `localhost`.

**"Standard OAuth is disabled"** (Connect mode)

Go to **Stripe Dashboard → Settings → Connect** and enable the Standard OAuth flow.

**"Online payments are not configured"**

No Stripe key or Connect account has been set up for this organization. Go to **Settings → Payments** to configure it.
