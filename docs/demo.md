# Running a public demo instance

Demo mode lets anyone click a link and land in a working Atrium workspace with
no account. It exists to answer the question the homepage cannot: *what is this
actually like to use?*

> **Demo mode permits anonymous sign-in.** Only ever turn it on for a throwaway
> deployment with its own database. Never on an instance that holds real
> workspaces.

## Why a separate deployment

Two reasons, both learned the hard way rather than guessed:

1. **Session cookies are per host.** On the same host as the real app, a
   signed-in customer who clicked "Enter demo" would have their own session
   replaced by the demo user's.
2. **The reset is destructive.** A cron truncates the demo workspace every 30
   minutes. That has no business running against the database your customers'
   data lives in.

## Configuration

| Variable | Example | Meaning |
|---|---|---|
| `DEMO_MODE` | `true` | Off unless exactly `true`. Everything below is ignored while it is off. |
| `DEMO_ORG_SLUG` | `demo` | The demo workspace's slug. The reset refuses any other target. |
| `DEMO_OWNER_EMAIL` | `owner@demo.invalid` | The account `/demo` signs visitors in as. |
| `DEMO_CLIENT_EMAIL` | `client@demo.invalid` | The account `/demo/client` signs visitors in as. |
| `DEMO_APP_URL` | `https://atrium.example.com` | The real app, for the banner's "Start free" link. |

Both addresses **must** end in `@demo.invalid`. A demo address pointing at a
real account would make that account anonymously signable, so the code refuses
anything else rather than trusting the operator to get it right.

## Deploying it (Coolify)

1. New application from the same repository and Dockerfile as production.
2. New Postgres database, separate from production.
3. Environment: the variables above, plus the usual `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `WEB_URL` and `API_URL` for the demo host.
4. Set `ALLOW_SIGNUPS=false` — the demo host should not mint real accounts.
5. Leave `BILLING_ENABLED` off and set no Stripe keys.
6. Point a hostname at it (for example `demo.example.com`) and let it serve
   `noindex`: the demo should not compete with the real app in search results.
7. Seed it once:

   ```bash
   bun run db:seed       # subscription plans, if this database is new
   bun run db:seed:demo  # the Northwind Studio demo workspace
   ```

   The demo workspace is pinned to the **pro** plan with no trial. This is not
   cosmetic: on the free plan `@PlanLimit` refuses a fourth project and
   `planHasFeature` blocks the seeded contract and invoices, and a trial would
   expire and quietly cripple the demo two weeks after launch.

## What the demo refuses

`DemoGuard` fences the demo workspace, and only that workspace: uploads,
invites, API keys, MCP grants, integrations, billing, payments, custom domains,
workspace settings, account deletion and workspace deletion. Each refusal
carries a message written to be shown to the visitor.

Uploads are refused by **capability, not by route**: any request to the demo
workspace carrying a `multipart/form-data` body is turned away. A list of
upload paths would silently fail to cover the next one somebody adds — and did:
the demo's own "Upload file" button posts to `POST /documents`, not
`/files/upload`. Uploads are off because anything a stranger uploads would sit
on your infrastructure, and the seeded files already show how files look.

Outbound email is dropped in `MailService` for any recipient on
`@demo.invalid`. The rule is on the address rather than the workspace because
most mail comes from scheduled tasks that no request guard sees — and because
attempting those addresses would bounce and spend your real domain's sending
reputation.

## Resets

- A scheduled reset runs every 30 minutes. It holds off for five minutes after
  anyone used the demo, so nobody watches their work vanish mid-click.
- The banner's "Reset demo" button resets on demand, forcing past that wait.
- Both refuse unless every owner of the target workspace is on
  `@demo.invalid`. Checking the slug would prove nothing, since the workspace
  is looked up *by* slug; the owner's address is something the seed guarantees
  and a real workspace cannot have. So pointing `DEMO_ORG_SLUG` at a live
  workspace fails closed instead of wiping it. Same contract as the
  integration-test guard refusing a database not named `*_test`.
- The `Organization` and `User` rows survive a reset, so sessions do too.

## Measurement

Demo entries are tracked as `atrium_demo_entered`, never as a signup. The
banner's "Start free" link carries `?ref=demo`, so conversions from the demo are
attributable across the two hosts. A demo counted as a signup would inflate the
exact number it was built to improve.
