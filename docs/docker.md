# Docker Deployment

Atrium ships as a single Docker image (`vibralabs/atrium`) that bundles the API, web app, Caddy reverse proxy, and an optional built-in PostgreSQL database. One container, one port (8080).

## Quick Start

Two variables are required: `BETTER_AUTH_SECRET`, and `WEB_URL` set to the
address people will open Atrium at:

```bash
docker run -d \
  --name atrium \
  -p 8080:8080 \
  -v atrium-db:/var/lib/postgresql/data \
  -v atrium-uploads:/app/uploads \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e WEB_URL=http://localhost:8080 \
  vibralabs/atrium:latest
```

Open `http://localhost:8080` and create your account.

## Docker Compose

```yaml
services:
  atrium:
    image: vibralabs/atrium:latest
    ports:
      - "8080:8080"
    environment:
      BETTER_AUTH_SECRET: "change-me-to-a-random-string-at-least-32-chars"
      WEB_URL: "http://localhost:8080"
    volumes:
      - atrium-db:/var/lib/postgresql/data
      - atrium-uploads:/app/uploads
    restart: unless-stopped

volumes:
  atrium-db:
  atrium-uploads:
```

## Using an External Database

If you already have a PostgreSQL instance, disable the built-in database and provide your connection string:

```bash
docker run -d \
  --name atrium \
  -p 8080:8080 \
  -v atrium-uploads:/app/uploads \
  -e USE_BUILT_IN_DB=false \
  -e DATABASE_URL=postgresql://user:password@your-db-host:5432/atrium \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e WEB_URL=http://localhost:8080 \
  vibralabs/atrium:latest
```

Or with Docker Compose:

```yaml
services:
  atrium:
    image: vibralabs/atrium:latest
    ports:
      - "8080:8080"
    environment:
      USE_BUILT_IN_DB: "false"
      DATABASE_URL: "postgresql://user:password@your-db-host:5432/atrium"
      BETTER_AUTH_SECRET: "change-me-to-a-random-string-at-least-32-chars"
      WEB_URL: "http://localhost:8080"
    volumes:
      - atrium-uploads:/app/uploads
    restart: unless-stopped

volumes:
  atrium-uploads:
```

The database schema is automatically applied on startup. To skip this (e.g. when using a connection pooler like PgBouncer), set `SKIP_DB_PUSH=true` and provide a `DIRECT_URL` pointing to the non-pooled connection.

## Public URL

Set `WEB_URL` to the address people actually open in a browser, with its scheme
and without a trailing slash. A value without `http://` or `https://`, such as
`192.168.1.10:8080`, stops the API at startup with an error naming the variable:

```
WEB_URL=https://atrium.example.com
```

Nothing in the image infers it, and the container logs a warning at startup when
it is missing. Leaving it unset or wrong breaks more than one thing:

- Caddy inside the image rewrites the `Origin` of every API request to `WEB_URL`,
  and the API only trusts that origin. A mismatch does not show up on the first
  sign-in (no cookie, so the origin is never checked) but every later one fails
  with "Invalid origin".
- invitation, password-reset and notification emails link to `localhost` and are
  unusable for your clients
- the API's CORS origin and CSP `connect-src` point at the wrong host
- Stripe return URLs and custom-domain detection resolve against the wrong host

Coolify, Cloudflare Tunnel, Nginx Proxy Manager, Traefik and similar all work the
same way: point them at port 8080 and set `WEB_URL` to the public address. Caddy
inside the container speaks plain HTTP on 8080, on the assumption that TLS is
terminated upstream.

Nothing else is needed. The image serves the web app and the API from one origin,
so `API_URL` defaults to `WEB_URL`, and Atrium does not read
`TRUSTED_PROXY_HEADERS`.

### Running over plain HTTP

If `WEB_URL` starts with `http://`, Atrium works, but nothing between the browser
and the server is encrypted. Browsers refuse `Secure` cookies over plain HTTP, so
Atrium turns that flag off to let sign-in work, and the workspace owner sees a
notice in the dashboard.

What that exposes, to anyone who can see the traffic (someone on the same Wi-Fi,
a compromised router, anyone along the route if the port is open to the internet):

- **Passwords.** Every sign-in sends the email and password in readable form.
- **Sessions.** The sign-in cookie can be copied and used to act as that person,
  with no password needed. For the owner, that means full control of the workspace.
- **Client data.** Files, invoices, messages and project details can be read as
  they load.
- **Tampering.** Pages can be changed in transit, for example to swap the payment
  details shown on an invoice.
- **Your clients too.** If clients sign in to the portal over the same address,
  their passwords and sessions are exposed the same way.

Some features also need HTTPS: browser push notifications and MCP sign-in for AI
clients won't work, and browsers mark the site "Not secure".

**When plain HTTP is reasonable:** a home or office network you trust, or a private
VPN such as Tailscale or WireGuard, with the port not forwarded to the internet and
no clients signing in from outside.

**Moving to HTTPS** (Cloudflare Tunnel, Nginx Proxy Manager, Caddy, Traefik, ...;
for a tunnel, see [Cloudflare Tunnel](#cloudflare-tunnel)):

1. Point the proxy or tunnel at port 8080.
2. Set `WEB_URL` to the `https://` address, and remove `SECURE_COOKIES=false` if you
   set it.
3. Redeploy the container (`docker compose up -d`, or Redeploy in Portainer or
   Coolify). A plain `docker restart` keeps the old settings.
4. From then on, sign in only through the `https://` address. Plain `http://`
   addresses stop keeping you signed in, and everyone signs in once more.

### Cloudflare Tunnel

If you reach Atrium through a Cloudflare Tunnel, set `WEB_URL` to the `https://`
tunnel address. Atrium then treats the install as HTTPS and cookies are `Secure`.

**How secure is it?** Traffic from people's browsers is encrypted to Cloudflare,
then through the tunnel to `cloudflared`. Only the last hop, from `cloudflared` to
Atrium on port 8080, is plain HTTP:

- **`cloudflared` on the same machine or Docker network:** that hop never leaves
  the machine. This is as secure as any HTTPS setup.
- **`cloudflared` on another machine on your network:** that hop crosses your
  local network unencrypted. Someone already on that network could read it. Fine
  on a home network you trust, weaker on a shared one.

**Port 8080 stays open on your network.** Unless you remove the port mapping,
anyone on your local network can still open `http://<server-ip>:8080`:

- Signing in there doesn't stick (the browser drops the `Secure` cookies), but the
  password is still sent unencrypted before that happens. Use the tunnel address
  everywhere, including at home.
- It skips anything you set up in Cloudflare, such as Access rules.
- **On a VPS or any server with a public IP**, `8080:8080` exposes Atrium over
  plain HTTP to the whole internet, skipping Cloudflare. Docker's port mappings
  bypass firewalls like `ufw`, so a closed firewall port doesn't protect you.
- To close it, run `cloudflared` on the same Docker network and drop the `ports:`
  line, or bind it to the machine only with `127.0.0.1:8080:8080`. Never forward
  8080 on your router.

**Pros:** no ports opened to the internet, your home IP stays hidden, certificates
are handled for you, and Cloudflare filters attacks before they reach you.

**Cons:**

- Cloudflare decrypts the traffic in the middle, so it can see what passes through,
  including client files and invoices.
- If Cloudflare or your tunnel is down, nobody can use Atrium, you included. The
  local address won't keep you signed in while `WEB_URL` is `https://`.
- Uploads over 100 MB are rejected on Cloudflare's Free and Pro plans, even if
  `MAX_FILE_SIZE_MB` allows them.
- At home, traffic goes out to Cloudflare and back, so large files load slower
  than a direct connection would.
- If you put Cloudflare Access in front, your clients must pass it to reach the
  portal, and AI tools connecting over MCP can't. Bypass `/api/mcp`,
  `/api/auth/mcp/` and `/.well-known/` if you use MCP. Atrium still requires an
  API key or an approved sign-in before an MCP client can read anything.

### Custom client domains

The container also listens on 443 with on-demand TLS, used when a client's own domain points straight at Atrium rather than through your proxy. Publish `-p 443:443` as well if you offer that; otherwise 8080 is all you need.

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Random string (min 32 chars) for signing auth tokens |
| `WEB_URL` | The public URL users open Atrium at, e.g. `https://atrium.example.com`. See [Public URL](#public-url) — sign-in fails with "Invalid origin" on the second login and email links point at `localhost` when this is unset or wrong. |

That's all you need. Everything below is optional.

### Optional

**Database**

| Variable | Default | Description |
|---|---|---|
| `USE_BUILT_IN_DB` | `true` | Set to `false` to use an external database |
| `DATABASE_URL` | auto-generated | PostgreSQL connection string (required when built-in DB is disabled) |
| `DIRECT_URL` | -- | Direct (non-pooled) database URL for schema sync |
| `SKIP_DB_PUSH` | `false` | Skip automatic schema sync on startup |

**File storage**

| Variable | Default | Description |
|---|---|---|
| `STORAGE_PROVIDER` | `local` | File storage backend: `local`, `s3`, `minio`, or `r2` |
| `S3_ENDPOINT` | -- | S3-compatible endpoint URL |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_BUCKET` | `atrium` | S3 bucket name |
| `S3_ACCESS_KEY` | -- | S3 access key |
| `S3_SECRET_KEY` | -- | S3 secret key |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size in megabytes |

**Email**

| Variable | Default | Description |
|---|---|---|
| `RESEND_API_KEY` | -- | Resend API key for email notifications |
| `EMAIL_FROM` | `noreply@atrium.local` | Sender address for outbound email |

**Payments**

| Variable | Default | Description |
|---|---|---|
| `STRIPE_CONNECT_CLIENT_ID` | -- | Stripe Connect platform client ID (`ca_...`). Enables the OAuth "Connect with Stripe" flow for client invoice payments. See [Stripe setup](stripe.md). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | -- | Signing secret for the Stripe Connect webhook endpoint (`whsec_...`) |
| `STRIPE_CURRENCY` | `usd` | ISO 4217 currency code for invoice payments (e.g. `eur`, `gbp`) |

**Networking**

| Variable | Default | Description |
|---|---|---|
| `API_URL` | same as `WEB_URL` | Public URL of the API. Only set this if the API is reachable at a different address than the app. |
| `SECURE_COOKIES` | from `WEB_URL` | Cookies are `Secure` unless `WEB_URL` (or `API_URL`) starts with `http://`. Set this to force either way. |

Running the web app and API as separate containers? See [Required for split deployments](configuration.md#required-for-split-deployments).

## Volumes

| Path | Purpose |
|---|---|
| `/var/lib/postgresql/data` | Built-in PostgreSQL data (not needed with external DB) |
| `/app/uploads` | Uploaded files (not needed with S3/MinIO/R2 storage) |

## Platform Guides

- [Portainer](portainer.md) — app template and stack deployment
- [Unraid](unraid.md) — step-by-step setup for Unraid with plain HTTP

## Building from Source

```bash
git clone https://github.com/Vibra-Labs/Atrium.git
cd Atrium
docker build -f docker/unified.Dockerfile -t atrium .
```

## Platform Support

The image runs on any platform that supports Docker: Docker Compose, Portainer, Coolify, Unraid, Synology, etc. Ready-made templates live in [`templates/portainer`](../templates/portainer) and [`unraid/`](../unraid) — see the [Platform Guides](#platform-guides) above. On Coolify, paste the compose file from this page into New > Docker Compose.
