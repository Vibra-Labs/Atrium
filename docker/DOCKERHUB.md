# Atrium

A self-hosted client portal for agencies and freelancers.

[![GitHub](https://img.shields.io/badge/GitHub-Vibra--Labs%2FAtrium-blue)](https://github.com/Vibra-Labs/Atrium)

## What is Atrium?

Atrium replaces shared drives, spreadsheets, and scattered emails with a single branded portal your clients can log into. You own the data and host it yourself.

## Features

- **Project management** — Customizable status pipeline per organization
- **File sharing** — Upload and deliver files via S3, MinIO, Cloudflare R2, or local storage
- **White-label branding** — Custom colors and logo applied to the client portal
- **Role-based access** — Owner/admin roles for your team, member role for clients
- **Email notifications** — Transactional email via Resend
- **Built-in database** — PostgreSQL included, no separate container needed

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

## Docker Compose

```yaml
services:
  atrium:
    image: vibralabs/atrium:latest
    ports:
      - "8080:8080"
    environment:
      BETTER_AUTH_SECRET: "change-me-to-a-random-string-at-least-32-chars"
    volumes:
      - atrium-db:/var/lib/postgresql/data
      - atrium-uploads:/app/uploads
    restart: unless-stopped

volumes:
  atrium-db:
  atrium-uploads:
```

## Using an External Database

Disable the built-in PostgreSQL and provide your own connection string:

```yaml
environment:
  USE_BUILT_IN_DB: "false"
  DATABASE_URL: "postgresql://user:password@your-db-host:5432/atrium"
  BETTER_AUTH_SECRET: "your-secret-here"
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **Yes** | — | Random string (min 32 chars) for signing auth tokens |
| `USE_BUILT_IN_DB` | No | `true` | Set to `false` to use an external database |
| `DATABASE_URL` | No | auto | PostgreSQL connection string (required when built-in DB is disabled) |
| `STORAGE_PROVIDER` | No | `local` | File storage: `local`, `s3`, `minio`, or `r2` |
| `S3_ENDPOINT` | No | — | S3-compatible endpoint URL |
| `S3_REGION` | No | `us-east-1` | S3 region |
| `S3_BUCKET` | No | `atrium` | S3 bucket name |
| `S3_ACCESS_KEY` | No | — | S3 access key |
| `S3_SECRET_KEY` | No | — | S3 secret key |
| `RESEND_API_KEY` | No | — | Resend API key for email |
| `EMAIL_FROM` | No | `noreply@yourdomain.com` | Sender address |
| `MAX_FILE_SIZE_MB` | No | `50` | Max upload size in MB |
| `SECURE_COOKIES` | No | `true` | Set to `false` only if accessing over plain HTTP with no HTTPS reverse proxy. **A reverse proxy with HTTPS (Caddy, nginx, Traefik) is strongly recommended.** |
| `SKIP_DB_PUSH` | No | `false` | Skip schema sync on startup |

## Volumes

| Path | Purpose |
|---|---|
| `/var/lib/postgresql/data` | Built-in PostgreSQL data |
| `/app/uploads` | Uploaded files (when using local storage) |

## Links

- [Documentation](https://github.com/Vibra-Labs/Atrium/blob/main/docs/docker.md)
- [GitHub](https://github.com/Vibra-Labs/Atrium)
- [Issues](https://github.com/Vibra-Labs/Atrium/issues)
