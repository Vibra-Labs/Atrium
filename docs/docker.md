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

## Behind a reverse proxy

Coolify, Cloudflare Tunnel, Nginx Proxy Manager, Traefik and similar all work the
same way: point them at port 8080 and set `WEB_URL` to the public address, with
its scheme and without a trailing slash:

```
WEB_URL=https://atrium.example.com
```

The container logs a warning at startup when it is missing. It matters because
Caddy inside the image rewrites the `Origin` of every API request to `WEB_URL`,
and the API only trusts that origin. A mismatch does not show up on the first sign-in (no cookie, so
the origin is never checked) but every later one fails with "Invalid origin".

Nothing else is needed: `API_URL` is derived, and Atrium does not read
`TRUSTED_PROXY_HEADERS`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | -- | Random string (min 32 chars) for signing auth tokens |
| `WEB_URL` | Yes | -- | The public URL users open Atrium at, e.g. `https://atrium.example.com`. Sign-in fails with "Invalid origin" on the second login when this does not match. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `USE_BUILT_IN_DB` | No | `true` | Set to `false` to use an external database |
| `DATABASE_URL` | No | auto-generated | PostgreSQL connection string (required when built-in DB is disabled) |
| `STORAGE_PROVIDER` | No | `local` | File storage backend: `local`, `s3`, `minio`, or `r2` |
| `S3_ENDPOINT` | No | -- | S3-compatible endpoint URL |
| `S3_REGION` | No | `us-east-1` | S3 region |
| `S3_BUCKET` | No | `atrium` | S3 bucket name |
| `S3_ACCESS_KEY` | No | -- | S3 access key |
| `S3_SECRET_KEY` | No | -- | S3 secret key |
| `RESEND_API_KEY` | No | -- | Resend API key for email notifications |
| `EMAIL_FROM` | No | `noreply@yourdomain.com` | Sender address for outbound email |
| `MAX_FILE_SIZE_MB` | No | `50` | Maximum upload size in megabytes |
| `SECURE_COOKIES` | No | `true` | Set to `false` only if accessing over plain HTTP with no HTTPS reverse proxy. See [Unraid / Plain HTTP Setup](#unraid--plain-http-setup). |
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

- [Unraid](unraid.md) — step-by-step setup for Unraid with plain HTTP

## Building from Source

```bash
git clone https://github.com/Vibra-Labs/Atrium.git
cd Atrium
docker build -f docker/unified.Dockerfile -t atrium .
```

## Platform Support

The image runs on any platform that supports Docker: Docker Compose, Portainer, Coolify, Unraid, Synology, etc. For Unraid, an official Community Applications template is available.
