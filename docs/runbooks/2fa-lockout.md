# Runbook: a user is locked out of two-factor (hosted)

Internal. Not linked from the public docs.

Use this when a user has lost their authenticator **and** their recovery codes, and nobody in their workspace can reset it for them (they are the only owner, or they also belong to another workspace, where the in-app reset is refused). Turning 2FA off for the wrong person hands them the account, so do not skip step 1.

## 1. Check who is asking

All of these must match:

- The request comes **from the account's email address** (reply to the support thread from that address, not a new one).
- Their **Stripe billing details** match the workspace's Stripe customer: last 4 digits of the card, billing name and billing address.

If they have also lost access to the email account: Stripe details as above, **plus** a one-time code you send to the phone number or postal address on the Stripe customer. Never use contact details the requester gives you in the request itself.

Record what you checked in the ticket.

## 2. Run the reset

Open a terminal in the hosted API container, then:

```bash
cd /app/apps/api
bun run script:disable-2fa <email> --reason "<ticket reference>"
```

This removes the user's authenticator and recovery codes, forgets their trusted devices, signs them out everywhere, emails them that 2FA was turned off, and writes a log line:

```json
{ "event": "two_factor.reset_by_operator", "userId": "...", "reason": "<ticket reference>" }
```

It is safe to run twice. "No user with that email." and exit code 1 mean the address is wrong.

## 3. If the container is unreachable

Run this in the hosted database console, replacing `<id>` with the user's id (`SELECT id FROM "user" WHERE email = '<email>';`):

```sql
BEGIN;
DELETE FROM two_factor WHERE "userId" = '<id>';
UPDATE "user" SET "twoFactorEnabled" = false WHERE id = '<id>';
DELETE FROM session WHERE "userId" = '<id>';
DELETE FROM verification WHERE identifier LIKE 'trust-device-%' AND value = '<id>';
COMMIT;
```

Then email the user yourself that two-factor was turned off, since the SQL sends nothing.

## 4. Tell the user

They sign in with their password (or "Forgot password" if that is lost too) and set up two-factor again in Settings → Security. If their workspace requires 2FA, they are taken to setup straight after signing in.
