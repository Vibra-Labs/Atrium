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
| `DEMO_MODE` | `true` | Off unless exactly `true`. Everything below is ignored while it is off. Needed by the **API**. |
| `DEMO_ORG_SLUG` | `demo` | The demo workspace's slug. The reset refuses any other target. |
| `DEMO_OWNER_EMAIL` | `owner@demo.invalid` | The account `/demo` signs visitors in as. |
| `DEMO_CLIENT_EMAIL` | `client@demo.invalid` | The account `/demo/client` signs visitors in as. |
| `DEMO_APP_URL` | `https://atrium.example.com` | The real app, for the banner's "Start free" link. Needed by the **web** service. |

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

`DemoGuard` fences the demo workspace, and only that workspace. It works as an
**allowlist**: reads are always fine, and writes are refused unless the path is
one the demo exists to show — projects, tasks, updates, comments, notes,
invoices, contacts, companies, labels, time entries, statuses, pipelines,
branding, a portal client's own profile, and signing out.

It started as a blocklist. Two independent reviews found the same class of hole
in it, because a blocklist has to enumerate an API surface the guard does not
own — and Better Auth's routes cannot be enumerated at all. Each miss was an
open door: uploads reached through `POST /documents` rather than
`/files/upload`; `PUT /two-factor/requirement` let one visitor put every later
visitor behind a 2FA enrollment gate that no reset clears; and
`POST /auth/organization/update` let a visitor rename the workspace, after
which every reset failed forever. Inverted, a route nobody thought of simply
does not work in the demo — visible and harmless — instead of being a hole.

**If you add a feature and it does not work in the demo, that is this
allowlist.** Add its path to `ALLOWED_WRITES` in
`apps/api/src/demo/demo.guard.ts` — but only if a reset can undo it. Anything
that writes to rows a reset deliberately preserves (`User`, `SystemSettings`,
`Organization`) must stay out, because a visitor's change there would outlive
the workspace it was made in.

Uploads are refused by **capability** on top of that: any request carrying a
`multipart/form-data` body is turned away, whatever its path, because anything
a stranger uploads would sit on your infrastructure. The seeded files already
show how files look.

Outbound email is dropped in `MailService` for any recipient on
`@demo.invalid`. The rule is on the address rather than the workspace because
most mail comes from scheduled tasks that no request guard sees — and because
attempting those addresses would bounce and spend your real domain's sending
reputation.

## Resets

- A scheduled reset runs every 30 minutes. It holds off for five minutes after
  anyone used the demo, so nobody watches their work vanish mid-click.
- There is no way to reset on demand, by design. Several visitors share the
  workspace at once, so a manual reset would let any one of them wipe it out
  from under the others. The banner shows a live countdown to the next
  scheduled reset instead. To force one, restart the demo instance or run
  `bun run db:seed:demo` against it.
- Both refuse unless every owner of the target workspace is on
  `@demo.invalid`. Checking the slug would prove nothing, since the workspace
  is looked up *by* slug; the owner's address is something the seed guarantees
  and a real workspace cannot have. So pointing `DEMO_ORG_SLUG` at a live
  workspace fails closed instead of wiping it. Same contract as the
  integration-test guard refusing a database not named `*_test`.
- The `Organization` and `User` rows survive a reset, so sessions do too.

## The banner is per workspace, not per host

Whether a page shows the demo banner comes from `/api/organization/current`,
which reports `isDemo` for the workspace being viewed — not from `DEMO_MODE` in
the web app. `DEMO_MODE` is instance-wide, while the fence is
organization-scoped, so reading the flag directly meant any other workspace on
the host saw the banner over its own data and an upload button disabled for no
reason. The e2e suite was a live demonstration of that drift.

## Measurement

The demo has its own four-step funnel, all Umami only:

| Event | Fired when | Counted |
|---|---|---|
| `atrium_demo_entered` | a visitor enters, with `kind: owner|client` | once per session |
| `atrium_demo_explored` | they open a project — the first real look | once per session |
| `atrium_demo_acted` | they create a project, task or update | once per session |
| `atrium_demo_cta_clicked` | they click "Start free" or "See the client view" | every click |

One number only says traffic arrived. Four say where it stopped: entered and
never explored is a first-impression problem, explored but never acted is a
product problem, acted but never clicked through is pricing or trust.

None of these is a signup. The
banner's "Start free" link carries `?ref=demo`, so conversions from the demo are
attributable across the two hosts. A demo counted as a signup would inflate the
exact number it was built to improve.
