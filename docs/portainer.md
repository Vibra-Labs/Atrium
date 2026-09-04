# Portainer Deployment

Atrium runs as a single container in Portainer — API, web app, reverse proxy, and a built-in PostgreSQL database in one image on port 8080.

## Adding the app template

Portainer app templates come from a URL you control. To add Atrium's:

1. Go to **Settings → App Templates**
2. Set the **URL** to:
   ```
   https://raw.githubusercontent.com/Vibra-Labs/Atrium/main/templates/portainer/templates.json
   ```
3. Click **Save application settings**
4. Open **App Templates** and search for **Atrium**

> Replacing the default template URL hides Portainer's built-in catalogue. To keep both, merge the Atrium entry into your own `templates.json` rather than pointing Portainer at this file directly.

## Deploying

Click the Atrium template and fill in:

| Field | Value |
|---|---|
| **Auth secret** | Required. At least 32 characters — generate with `openssl rand -base64 32` |
| **Secure cookies** | `true` behind an HTTPS reverse proxy, `false` for plain HTTP |
| **External database URL** | Leave blank to use the built-in PostgreSQL |
| **Storage provider** | `local` (default), or `s3` / `minio` / `r2` |

Click **Deploy the container** and open `http://your-host:8080` to create your account.

## Volumes

The template binds two host paths:

| Host path | Container path | Contents |
|---|---|---|
| `/opt/atrium/db` | `/var/lib/postgresql/data` | Built-in PostgreSQL data |
| `/opt/atrium/uploads` | `/app/uploads` | Uploaded files |

Adjust these on the deployment screen if you keep application data elsewhere. Both are unnecessary if you use an external database and S3-compatible storage.

## Without the template

You can also deploy Atrium as a stack: **Stacks → Add stack → Web editor**, then paste the compose file from [Docker Deployment](docker.md).

## Optional configuration

Add these under **Advanced container settings → Env** at deploy time, or via **Duplicate/Edit** afterwards:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Enables invitation and password-reset emails ([Resend](https://resend.com)) |
| `EMAIL_FROM` | From address for outgoing email |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible storage credentials |
| `SKIP_DB_PUSH` | Set to `true` to skip automatic schema sync (pooled connections) |

See [Configuration](configuration.md) for the full list.

## Updating

Use **Recreate** on the container with **Pull latest image** enabled. Database migrations run automatically on startup.

## Troubleshooting

**403 "Invalid or missing CSRF token".** You are accessing Atrium over plain HTTP with `SECURE_COOKIES=true`. The browser silently drops the `Secure` cookies. Set `SECURE_COOKIES=false`, or put an HTTPS reverse proxy in front.

**Container exits immediately.** Check the logs for `Missing required environment variable: BETTER_AUTH_SECRET`. Portainer passes empty env vars through, so a blank auth secret fails the same way a missing one does.

**Data lost after recreating the container.** Confirm both volume bindings survived the recreate — Portainer drops them if you deploy from the template a second time rather than using **Recreate**.
