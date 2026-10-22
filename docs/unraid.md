# Unraid Installation

Atrium runs as a single Docker container on Unraid. One image, one port — includes the API, web app, reverse proxy, and a built-in PostgreSQL database.

## Prerequisites

- Unraid 6.x or 7.x
- Docker enabled in Unraid settings

## Installation

1. In the Unraid Docker UI, click **Add Container**
2. Set **Repository** to `vibralabs/atrium:latest`
3. Set **Network Type** to `Bridge`

### Port Mapping

Map your desired host port to container port `8080`:

| Host Port | Container Port |
|---|---|
| `8080` (or any available port) | `8080` |

> **Important:** The container port must always be `8080` — that's what Atrium listens on internally. Only change the host port if `8080` is already in use on your server.

### Environment Variables

When adding environment variables in Unraid, make sure both the **Name/Key** field and **Value** field are filled in. If the Key field is empty, Unraid won't pass the variable to the container.

| Variable | Value | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | *(random string, min 32 chars)* | Generate with `openssl rand -base64 32` in the Unraid terminal |

### Volume Mappings

| Host Path | Container Path | Purpose |
|---|---|---|
| `/mnt/user/appdata/atrium/db` | `/var/lib/postgresql/data` | PostgreSQL data |
| `/mnt/user/appdata/atrium/uploads` | `/app/uploads` | Uploaded files |

### Apply

Click **Apply** and open `http://your-unraid-ip:PORT` to create your account.

## Plain HTTP and cookies

When `WEB_URL` starts with `http://`, Atrium turns off the cookie `Secure` flag so sign-in works without HTTPS (browsers drop `Secure` cookies over plain HTTP). Logins then travel unencrypted, and the workspace owner sees a notice in the dashboard saying so. See [Running over plain HTTP](docker.md#running-over-plain-http) for what that exposes and when it's reasonable.

**If you add an HTTPS reverse proxy** (e.g., Nginx Proxy Manager, Caddy, Traefik), change `WEB_URL` to the `https://` address and cookies become `Secure` again. Older installs with `SECURE_COOKIES=false` keep working; remove it once you're on HTTPS.

## Optional: External Database

If you prefer to use an existing PostgreSQL instance instead of the built-in one:

| Variable | Value |
|---|---|
| `USE_BUILT_IN_DB` | `false` |
| `DATABASE_URL` | `postgresql://user:password@your-db-host:5432/atrium` |

You can remove the `/var/lib/postgresql/data` volume mapping when using an external database.

## Optional: Email Notifications

To enable email notifications (invitations, password resets):

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your [Resend](https://resend.com) API key |
| `EMAIL_FROM` | `noreply@yourdomain.com` |

## Optional: S3 File Storage

To use S3-compatible storage instead of local disk:

| Variable | Value |
|---|---|
| `STORAGE_PROVIDER` | `s3`, `minio`, or `r2` |
| `S3_ENDPOINT` | Your S3-compatible endpoint URL |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY` | Access key |
| `S3_SECRET_KEY` | Secret key |

You can remove the `/app/uploads` volume mapping when using S3 storage.

## Updating

1. In the Unraid Docker UI, click the container icon and select **Force Update** to pull the latest image
2. The container will restart automatically
3. Database migrations run automatically on startup

> **Note:** Simply restarting the container may not pull the newest image. Use **Force Update** to ensure you have the latest version.

## Troubleshooting

### 403 "Invalid or missing CSRF token"
Make sure `WEB_URL` is the full address you open, including `http://` (e.g. `http://192.168.1.10:4747`). If you set `SECURE_COOKIES=true`, remove it when accessing over plain HTTP.

### "Missing required environment variable: BETTER_AUTH_SECRET"
The API won't start without this. Check that the env var has both the **Key** (`BETTER_AUTH_SECRET`) and **Value** filled in within the Unraid container config. If the Key field is empty, Unraid silently drops the variable.

### API failed to start / 502 errors
The web UI may load but API calls return 502. Check the container logs — scroll up from "API failed to start" to find the actual error. Common causes:
- Missing `BETTER_AUTH_SECRET` (see above)
- Secret is shorter than 32 characters

### Container exits with code 1
Check logs for the specific error. Usually a missing or invalid environment variable.

### Data not persisting after restart
Verify your volume mappings point to `/mnt/user/appdata/atrium/db` and `/mnt/user/appdata/atrium/uploads`.

### Port not accessible
Make sure the **container port** is `8080` (not your custom port). The host port is what you access from your browser; the container port is always `8080`.
