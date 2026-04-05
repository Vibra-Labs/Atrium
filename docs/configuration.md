# Configuration

## Environment Variables

All configuration lives in a single `.env` file. See [`.env.example`](../.env.example) for the full list.

| Variable             | Description                                      | Default                          |
|----------------------|--------------------------------------------------|----------------------------------|
| `DATABASE_URL`       | PostgreSQL connection string                     | `postgresql://atrium:atrium@localhost:5432/atrium` |
| `BETTER_AUTH_SECRET` | Secret key for auth token signing (min 32 chars) | `change-me-in-production`        |
| `API_URL`            | API URL (internal, server-to-server)             | `http://localhost:3001`          |
| `WEB_URL`            | Web app URL (used for CORS)                      | `http://localhost:3000`          |
| `NEXT_PUBLIC_API_URL`| Browser-facing API URL (Next.js client-side)     | `http://localhost:3001`          |
| `STORAGE_PROVIDER`   | File storage backend: `local`, `s3`, `minio`, `r2` | `local`                       |
| `UPLOAD_DIR`         | Local upload directory (when using local storage) | `./uploads`                     |
| `S3_ENDPOINT`        | S3-compatible endpoint (for MinIO/R2)            | --                               |
| `S3_REGION`          | AWS region                                       | `us-east-1`                      |
| `S3_BUCKET`          | Bucket name                                      | `atrium`                         |
| `S3_ACCESS_KEY`      | S3 access key                                    | --                               |
| `S3_SECRET_KEY`      | S3 secret key                                    | --                               |
| `RESEND_API_KEY`     | Resend API key for transactional email           | --                               |
| `EMAIL_FROM`         | Sender address for outbound email                | `noreply@atrium.local`           |
| `MAX_FILE_SIZE_MB`   | Maximum upload size in megabytes                 | `50`                             |
| `BILLING_ENABLED`    | Set to `true` to enable billing/plan gates (hosted only) | --                        |
| `LOG_LEVEL`          | Pino log level                                   | `info`                           |

`DATABASE_URL` and `BETTER_AUTH_SECRET` are required -- the API will refuse to start without them.

> **Upgrading from v1.3 or earlier?** `BETTER_AUTH_URL` has been renamed to `API_URL`. The old name still works as a fallback but will be removed in a future release.

## Storage Providers

Set `STORAGE_PROVIDER` in your `.env`:

- **`local`** -- Files saved to `UPLOAD_DIR`. Default for development.
- **`s3`** -- Amazon S3. Set `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_REGION`.
- **`minio`** -- Self-hosted S3-compatible storage. Set `S3_ENDPOINT` and credentials.
- **`r2`** -- Cloudflare R2. Set `S3_ENDPOINT`, `S3_BUCKET`, and credentials.
