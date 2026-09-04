# Docker Deployment

Atrium ships as a single Docker image (`vibralabs/atrium`) that bundles the API, web app, Caddy reverse proxy, and an optional built-in PostgreSQL database. One container, one port (8080).

## Quick Start

The only required variable is `BETTER_AUTH_SECRET`:

```bash
docker run -d \
  --name atrium \
  -p 8080:8080 \
  -v atrium-db:/var/lib/postgresql/data \
  -v atrium-uploads:/app/uploads \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  vibralabs/atrium:latest
```

Open `http://localhost:8080` and create your account.

## Public URL

Set `WEB_URL` to the address people actually open in a browser. Nothing in the image infers it, and it defaults to `http://localhost:3000`, so if you skip it:

- invitation, password-reset and notification emails link to `localhost` and are unusable for your clients
- the API's CORS origin and CSP `connect-src` point at `localhost:3000`
- Stripe return URLs and custom-domain detection resolve against the wrong host

```bash
docker run -d \
  --name atrium \
  -p 8080:8080 \
  -v atrium-db:/var/lib/postgresql/data \
  -v atrium-uploads:/app/uploads \
  -e WEB_URL=https://portal.example.com \
  -e API_URL=https://portal.example.com \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  vibralabs/atrium:latest
```

The unified image serves the web app and the API from the same origin behind its built-in Caddy proxy, so `WEB_URL` and `API_URL` are the same value. Put an HTTPS reverse proxy in front of port 8080 — Caddy inside the container speaks plain HTTP there, on the assumption that TLS is terminated upstream.

### Custom client domains

The container also listens on 443 with on-demand TLS, used when a client's own domain points straight at Atrium rather than through your proxy. Publish `-p 443:443` as well if you offer that; otherwise 8080 is all you need.

## Docker Compose

```yaml
services:
  atrium:
    image: vibralabs/atrium:latest
    ports:
      - "8080:8080"
    environment:
      BETTER_AUTH_SECRET: "change-me-to-a-random-string-at-least-32-chars"
      WEB_URL: "https://portal.example.com"
      API_URL: "https://portal.example.com"
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
      WEB_URL: "https://portal.example.com"
      API_URL: "https://portal.example.com"
    volumes:
      - atrium-uploads:/app/uploads
    restart: unless-stopped

volumes:
  atrium-uploads:
```

The database schema is automatically applied on startup. To skip this (e.g. when using a connection pooler like PgBouncer), set `SKIP_DB_PUSH=true` and provide a `DIRECT_URL` pointing to the non-pooled connection.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | -- | Random string (min 32 chars) for signing auth tokens |
| `WEB_URL` | No | `http://localhost:3000` | Public URL users visit. See [Public URL](#public-url) — leaving it unset sends broken links in email. |
| `API_URL` | No | `http://localhost:3001` | Public URL of the API. In the unified image this is the same origin as `WEB_URL`. |
| `USE_BUILT_IN_DB` | No | `true` | Set to `false` to use an external database |
| `DATABASE_URL` | No | auto-generated | PostgreSQL connection string (required when built-in DB is disabled) |
| `STORAGE_PROVIDER` | No | `local` | File storage backend: `local`, `s3`, `minio`, or `r2` |
| `S3_ENDPOINT` | No | -- | S3-compatible endpoint URL |
| `S3_REGION` | No | `us-east-1` | S3 region |
| `S3_BUCKET` | No | `atrium` | S3 bucket name |
| `S3_ACCESS_KEY` | No | -- | S3 access key |
| `S3_SECRET_KEY` | No | -- | S3 secret key |
| `RESEND_API_KEY` | No | -- | Resend API key for email notifications |
| `EMAIL_FROM` | No | `noreply@atrium.local` | Sender address for outbound email |
| `MAX_FILE_SIZE_MB` | No | `50` | Maximum upload size in megabytes |
| `SECURE_COOKIES` | No | `true` in the image | Set to `false` only if accessing over plain HTTP with no HTTPS reverse proxy. Falls back to `NODE_ENV=production`, which the published image sets. See [Unraid](unraid.md). |
| `SKIP_DB_PUSH` | No | `false` | Skip automatic schema sync on startup |
| `DIRECT_URL` | No | -- | Direct (non-pooled) database URL for schema sync |
| `STRIPE_CONNECT_CLIENT_ID` | No | -- | Stripe Connect platform client ID (`ca_...`). Enables the OAuth "Connect with Stripe" flow for client invoice payments. See [Stripe setup](stripe.md). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | No | -- | Signing secret for the Stripe Connect webhook endpoint (`whsec_...`) |
| `STRIPE_CURRENCY` | No | `usd` | ISO 4217 currency code for invoice payments (e.g. `eur`, `gbp`) |

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
