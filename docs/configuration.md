# Configuration

## Environment Variables

All configuration lives in a single `.env` file. See [`.env.example`](../.env.example) for the full list.

### Required

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Random string, at least 32 characters, for signing sessions |
| `WEB_URL` | The address people open Atrium at, e.g. `https://atrium.example.com`. Used for sign-in, CORS and every link in email. See [docker.md](docker.md#public-url) |
| `DATABASE_URL` | PostgreSQL connection string. The Docker image starts its own database when this is unset |

That's all you need. Everything below is optional.

### Optional

**File storage**

| Variable | Default | Description |
|---|---|---|
| `STORAGE_PROVIDER` | `local` | File storage backend: `local`, `s3`, `minio`, `r2` |
| `UPLOAD_DIR` | `./uploads` | Local upload directory (when using local storage) |
| `S3_ENDPOINT` | -- | S3-compatible endpoint (for MinIO/R2) |
| `S3_REGION` | `us-east-1` | AWS region |
| `S3_BUCKET` | `atrium` | Bucket name |
| `S3_ACCESS_KEY` | -- | S3 access key |
| `S3_SECRET_KEY` | -- | S3 secret key |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size in megabytes |

**Email**

| Variable | Default | Description |
|---|---|---|
| `RESEND_API_KEY` | -- | Resend API key for transactional email |
| `EMAIL_FROM` | `noreply@atrium.local` | Sender address for outbound email |

**Other**

| Variable | Default | Description |
|---|---|---|
| `MCP_OAUTH_ENABLED` | `true` | Allow MCP clients to connect by signing in (OAuth). Requires a public HTTPS URL. API keys work regardless |
| `BILLING_ENABLED` | -- | Set to `true` to enable billing/plan gates (hosted only) |
| `LOG_LEVEL` | `info` | Pino log level |

> **Upgrading from v1.3 or earlier?** `BETTER_AUTH_URL` has been renamed to `API_URL`. The old name still works as a fallback but will be removed in a future release.

### Required for split deployments

The Docker image runs the web app and API in one container and sets these for you. If you run them separately (`docker/web.Dockerfile` and `docker/api.Dockerfile`, or on different servers), set all three:

| Variable | Set on | Example | Description |
|---|---|---|---|
| `API_URL` | API | `https://api.example.com` | The API's public address, used in sign-in, OAuth, Stripe webhook and email logo links |
| `INTERNAL_API_URL` | Web | `http://atrium-api:3001` | The API's private address, used when the web app renders pages. Never sent to browsers. The web app refuses to start without it |
| `NEXT_PUBLIC_API_URL` | Web, at build time | `https://api.example.com` | The address browsers use. Leave empty when the API is on the same origin as the app |

## Storage Providers

Set `STORAGE_PROVIDER` in your `.env`:

- **`local`** -- Files saved to `UPLOAD_DIR`. Default for development.
- **`s3`** -- Amazon S3. Set `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_REGION`.
- **`minio`** -- Self-hosted S3-compatible storage. Set `S3_ENDPOINT` and credentials.
- **`r2`** -- Cloudflare R2. Set `S3_ENDPOINT`, `S3_BUCKET`, and credentials.
