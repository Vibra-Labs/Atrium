# Coolify Deployment

Atrium runs on Coolify as a single container — API, web app, reverse proxy, and a built-in PostgreSQL database in one image on port 8080. Coolify terminates TLS and routes traffic to it, so no extra proxy configuration is needed.

## Option 1: Deploy from the compose file (works today)

1. In your Coolify project, click **+ New → Docker Compose (Empty)**
2. Paste the contents of [`templates/coolify/atrium.yaml`](../templates/coolify/atrium.yaml)
3. Click **Deploy**

Coolify assigns a domain automatically and fills in `SERVICE_FQDN_ATRIUM_8080`. The auth secret and database password are generated per install — you never set a `change-me` value.

## Option 2: One-click service template

Once the template is merged into Coolify's service catalogue, it appears under **+ New → Service → Atrium**. Search for "Atrium" and deploy.

## Magic variables

Coolify substitutes these at deploy time. They are what make the template safe to install unattended:

| Variable | What Coolify does |
|---|---|
| `SERVICE_FQDN_ATRIUM_8080` | Generates a domain and points the proxy at container port 8080 |
| `SERVICE_BASE64_64_AUTH` | Generates a random 64-character secret for `BETTER_AUTH_SECRET` |
| `SERVICE_PASSWORD_POSTGRES` | Generates a random password for the built-in database |

`WEB_URL` and `API_URL` are both set from `$SERVICE_URL_ATRIUM`, the URL Coolify derives from that domain. They are what email invitation and password-reset links are built from, so they must match the domain your clients actually visit — if you change the domain in Coolify later, redeploy so both pick up the new value.

Generated values are stored per deployment, so they survive restarts and redeploys.

## Optional configuration

Set these in the **Environment Variables** tab after the first deploy:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Enables invitation and password-reset emails ([Resend](https://resend.com)) |
| `EMAIL_FROM` | From address for outgoing email |
| `STORAGE_PROVIDER` | `local` (default), `s3`, `minio`, or `r2` |
| `MAX_FILE_SIZE_MB` | Upload size limit, defaults to `50` |

See [Configuration](configuration.md) for the full list.

## Using an external database

The built-in PostgreSQL is used whenever `DATABASE_URL` is unset. To point at your own instead:

```
USE_BUILT_IN_DB=false
DATABASE_URL=postgresql://user:password@your-db-host:5432/atrium
```

You can then drop the `atrium-db` volume from the compose file. If your database sits behind a connection pooler, also set `SKIP_DB_PUSH=true` and run schema syncs yourself.

## Persistence

Two named volumes hold everything stateful:

| Volume | Contents |
|---|---|
| `atrium-db` | Built-in PostgreSQL data |
| `atrium-uploads` | Uploaded files (local storage only) |

Both are unnecessary if you use an external database and S3-compatible storage.

## Updating

Click **Redeploy** in Coolify with **Pull latest image** enabled. Database migrations run automatically on startup.

## Troubleshooting

**Deployment succeeds but the domain 502s.** The first boot initialises PostgreSQL and pushes the schema, which can take a minute. The healthcheck has a 60-second start period; check the container logs for `API ready`.

**403 "Invalid or missing CSRF token".** Atrium sets `Secure` cookies by default. This is correct behind Coolify's HTTPS proxy — if you see this error, you are reaching the container over plain HTTP. Either enable HTTPS on the domain or set `SECURE_COOKIES=false`.

**"Missing required environment variable: BETTER_AUTH_SECRET".** The magic variable was removed or renamed. Restore `BETTER_AUTH_SECRET=$SERVICE_BASE64_64_AUTH`, or set a static value of at least 32 characters.
