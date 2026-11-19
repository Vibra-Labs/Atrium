# Atrium

A self-hosted client portal for agencies and freelancers.

[![GitHub](https://img.shields.io/badge/GitHub-Vibra--Labs%2FAtrium-blue)](https://github.com/Vibra-Labs/Atrium)

## What is Atrium?

Atrium replaces shared drives, spreadsheets, and scattered emails with a single branded portal your clients can log into. You own the data and host it yourself.

## Features

### Client portal
- **Branded portal** — Your logo, colors, and branded login page; optionally your own domain with automatic SSL
- **Projects & updates** — Post progress updates with images and embeds (YouTube, Loom, Figma, Google Docs, Canva); clients see a clear current status
- **Files & links** — Upload deliverables or link external content; stored on local disk, S3, MinIO, or Cloudflare R2
- **Tasks & client requests** — Task board with statuses, assignees, labels, and drag-and-drop; clients can submit requests from the portal
- **Comments & notifications** — Threaded discussion on updates and tasks, with in-app, email, and web push
- **View as customer** — Preview the portal exactly as a client sees it, with changes blocked

### Get paid
- **Invoicing** — Draft, send, and track invoices with PDF generation and in-app preview
- **Online payments** — Clients pay invoices via Stripe Checkout (Direct Keys or Connect)
- **Time tracking** — Timers and manual entries per project and task, hourly rates, one-click invoices from un-invoiced time
- **Reports** — Time by project, user, and task, with CSV export

### Contracts & approvals
- **Documents** — Send quotes, contracts, and NDAs for client acknowledgement or approval
- **E-signatures** — Signature fields, signing order, reminders, expiry, and a signed certificate with audit trail
- **Decisions** — Ask clients to vote on options directly in the portal

### Run the agency
- **Potential contracts** — Track work before it's signed, with stage, value, expected close, and cost/margin; mark Won to turn it into active work
- **Contacts** — People and companies, lead sources, follow-up reminders, CSV import and export
- **Calendar** — Tasks, project dates, and invoice due dates on a month grid or agenda
- **Team & roles** — Owners and admins on your team; clients join as members with access to their own projects only
- **Multiple organizations** — Run several companies from one install; close public signups with `ALLOW_SIGNUPS=false`
- **Global search** — Full-text search across projects, files, tasks, clients, and updates
- **Data export** — CSV for projects, invoices, people, tasks, and time entries

### Platform
- **MCP server** — Connect Claude or other AI clients to manage your workspace via OAuth sign-in or API keys
- **Integrations** — Slack, Discord, and signed webhooks for workspace events
- **Authentication** — Email/password, magic link, and passwordless client sign-in; two-factor via authenticator app, passkeys, and optional "require 2FA for staff"
- **Email** — Resend or any SMTP server, configurable per organization
- **Dark mode** — Per-user toggle, follows the system by default
- **Self-hosted** — Single image with bundled Postgres option, Unraid template, ARM support

## Quick Start

Two variables are required: `BETTER_AUTH_SECRET`, and `WEB_URL` set to the address people will open Atrium at:

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

## Unraid Setup

1. In the Unraid Docker UI, click **Add Container**
2. Set the **Repository** to `vibralabs/atrium:latest`
3. Under **Port Mappings**, map your desired host port (e.g., `4747`) to container port `8080`
4. Add the following **Environment Variables**:
   - `BETTER_AUTH_SECRET` — a random string of at least 32 characters (generate one with `openssl rand -base64 32` in the terminal)
   - `WEB_URL` — the address you open Atrium at, e.g. `http://192.168.1.10:4747`
5. Add the following **Volume Mappings** (set the host paths to your appdata directory):
   - `/mnt/user/appdata/atrium/db` → `/var/lib/postgresql/data`
   - `/mnt/user/appdata/atrium/uploads` → `/app/uploads`
6. Set **Network Type** to `Bridge`
7. Click **Apply**

Open `http://your-unraid-ip:4747` and create your account.

> **Note:** Over plain HTTP, logins travel unencrypted and Atrium shows the owner a notice saying so. If you later add an HTTPS reverse proxy (e.g., Nginx Proxy Manager, Caddy, Traefik), change `WEB_URL` to the `https://` address.

## Using an External Database

Disable the built-in PostgreSQL and provide your own connection string:

```yaml
environment:
  USE_BUILT_IN_DB: "false"
  DATABASE_URL: "postgresql://user:password@your-db-host:5432/atrium"
  BETTER_AUTH_SECRET: "your-secret-here"
  WEB_URL: "https://atrium.example.com"
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **Yes** | — | Random string (min 32 chars) for signing auth tokens |
| `WEB_URL` | **Yes** | — | The public URL users open Atrium at, e.g. `https://atrium.example.com`. Sign-in fails after the first login when this does not match. |
| `USE_BUILT_IN_DB` | No | `true` | Set to `false` to use an external database |
| `DATABASE_URL` | No | auto | PostgreSQL connection string (required when built-in DB is disabled) |
| `DIRECT_URL` | No | — | Non-pooled connection used for schema sync, when `DATABASE_URL` points at a pooler such as PgBouncer |
| `ALLOW_SIGNUPS` | No | `true` | Set to `false` to close public signup; invited users can still join |
| `STORAGE_PROVIDER` | No | `local` | File storage: `local`, `s3`, `minio`, or `r2` |
| `UPLOAD_DIR` | No | `./uploads` | Directory for local file storage |
| `S3_ENDPOINT` | No | — | S3-compatible endpoint URL |
| `S3_REGION` | No | `us-east-1` | S3 region |
| `S3_BUCKET` | No | `atrium` | S3 bucket name |
| `S3_ACCESS_KEY` | No | — | S3 access key |
| `S3_SECRET_KEY` | No | — | S3 secret key |
| `RESEND_API_KEY` | No | — | Resend API key for email. SMTP is configured per organization in the app. |
| `EMAIL_FROM` | No | `noreply@yourdomain.com` | Sender address |
| `MAX_FILE_SIZE_MB` | No | `50` | Max upload size in MB |
| `SECURE_COOKIES` | No | from `WEB_URL` | Cookies are `Secure` unless `WEB_URL` starts with `http://`. Set this to force either way. **A reverse proxy with HTTPS (Caddy, nginx, Traefik) is strongly recommended.** |
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
