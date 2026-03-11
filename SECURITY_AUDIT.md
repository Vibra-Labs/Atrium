# Security Audit Report — Atrium

**Date:** 2026-03-11
**Scope:** Full codebase review (apps/api, apps/web, packages/*, docker/, e2e/)

---

## Executive Summary

Atrium demonstrates **strong security practices overall**. The codebase includes CSRF protection, input validation, role-based access control, encrypted secret storage, proper session management, and defense-in-depth with multiple security layers. A few areas warrant attention, primarily around local file storage path traversal, session cache sizing, and production hardening.

---

## Findings

### CRITICAL — None Found

No critical vulnerabilities were identified.

---

### HIGH — 1 Finding

#### H1: Local Storage Path Traversal Risk

**File:** `apps/api/src/files/storage/local.storage.ts:17-19`
**File:** `apps/api/src/files/files.service.ts:74`

The `LocalStorage.getFilePath()` method joins user-influenced input with the upload directory using `path.join()`. While the storage key is constructed using `sanitizeFilename()` on the original filename, the `orgId` and `projectId` components come from the authenticated session/query parameter and are UUIDs — but they are not validated as UUIDs before being used in the path.

The `sanitizeFilename` function (`apps/api/src/common/utils/sanitize.ts:7-10`) strips path separators from the filename portion, but if an attacker could influence `projectId` to contain `../` sequences, they could write files outside the upload directory.

**Mitigating factors:**
- `projectId` is validated against the database (`files.service.ts:68-71`) — a value containing `../` would not match any DB record
- `orgId` comes from the authenticated session, not user input
- S3/R2/MinIO providers are not affected

**Recommendation:** Add explicit path traversal validation in `LocalStorage.getFilePath()`:
```typescript
private getFilePath(key: string): string {
  const filePath = path.resolve(this.uploadDir, key);
  if (!filePath.startsWith(path.resolve(this.uploadDir))) {
    throw new Error("Path traversal detected");
  }
  return filePath;
}
```

---

### MEDIUM — 6 Findings

#### M1: Unbounded In-Memory Session Cache

**File:** `apps/api/src/auth/session.middleware.ts:19,117`

The session cache uses a `Map` with eviction only when `size > 1000`. Under high load or a session-stuffing attack, the cache could grow to 1000 entries before any cleanup occurs. The eviction loop at line 117 only removes *expired* entries — if 1000+ sessions are all still valid, memory grows unbounded.

**Recommendation:** Use an LRU cache with a hard maximum size, or switch to Redis-backed session caching for production.

#### M2: CSRF Double-Submit Cookie Without Binding to Session

**File:** `apps/api/src/common/guards/csrf.guard.ts:76-82`

The CSRF implementation uses the double-submit cookie pattern, which is a valid approach. However, the CSRF token is not cryptographically bound to the user's session. An attacker who can set cookies on the domain (e.g., via a subdomain XSS or related-domain attack) could set both the cookie and header to a known value.

**Mitigating factors:**
- CORS is locked to a single origin (`main.ts:107-110`)
- `sameSite: "lax"` prevents cross-site cookie sending
- Requires subdomain cookie injection, which is a high bar

**Recommendation:** Consider binding the CSRF token to the session by using `HMAC(session_id, csrf_secret)` as the token.

#### M3: `trust proxy` Set to `true` (Accepts All Proxies)

**File:** `apps/api/src/main.ts:85`

Setting `trust proxy` to `true` means Express trusts *all* `X-Forwarded-For` headers. If the app is deployed without a trusted reverse proxy (or with misconfigured infrastructure), an attacker could spoof their IP address, bypassing rate limiting.

**Recommendation:** Set to a specific number (e.g., `1`) or list of trusted proxy IPs when possible, depending on deployment topology.

#### M4: Health Endpoint Skips All Rate Limiting

**File:** `apps/api/src/health.controller.ts:5`

The health controller uses `@SkipThrottle()` at the class level and executes a database query (`SELECT 1`). An attacker could abuse this to amplify load on the database without hitting rate limits.

**Mitigating factors:**
- Health checks typically sit behind a load balancer that rate-limits externally
- The query is minimal (`SELECT 1`)

**Recommendation:** Apply a generous but finite rate limit (e.g., 30 req/min) instead of skipping throttling entirely.

#### M5: Default Docker Compose Credentials

**File:** `docker-compose.yml:6,23-24`
**File:** `docker-compose.dev.yml:6`

Default PostgreSQL password (`atrium`) and a placeholder `BETTER_AUTH_SECRET` value are hardcoded in Docker Compose files. While these are intended for development, users may deploy with these defaults.

**Mitigating factors:**
- `main.ts:44-58` refuses to start in production with the default secret
- Documentation warns about changing credentials

**Recommendation:** Reference `.env` files from Docker Compose rather than hardcoding defaults: `${POSTGRES_PASSWORD:-atrium}`.

#### M6: Updates Endpoint Lacks File Extension Blocking

**File:** `apps/api/src/updates/updates.service.ts:51-54`

The project updates attachment upload validates file size (10MB) but does **not** apply the `BLOCKED_EXTENSIONS` check that exists in `files.service.ts`. An attacker with `owner`/`admin` role could upload executable files (`.exe`, `.bat`, `.ps1`, etc.) as update attachments.

**Recommendation:** Apply the same `BLOCKED_EXTENSIONS` check from `files.service.ts` to the updates attachment upload path.

---

### LOW — 9 Findings

#### L1: No File Content-Type Validation (Magic Bytes)

**File:** `apps/api/src/files/files.service.ts:60-65`

File upload validates extension against `BLOCKED_EXTENSIONS` but does not check magic bytes / file signatures. An attacker could upload a `.png` file that actually contains executable content (polyglot file).

**Mitigating factors:**
- The `Content-Disposition: attachment` header on download prevents browser execution
- Blocked extensions cover common executables

**Recommendation:** Consider adding magic byte validation for critical file types using a library like `file-type`.

#### L2: Logo Upload Extension Not Validated Against MIME Type

**File:** `apps/api/src/branding/branding.controller.ts:63-67,79`

The branding logo upload validates MIME type but derives the file extension from `originalname` without cross-referencing against the declared MIME type. A file could be uploaded with a `.html` extension but `image/png` MIME type.

**Recommendation:** Derive extension from MIME type rather than user-provided filename.

#### L3: Sensitive Data in Error Responses (Minor)

**File:** `apps/api/src/common/filters/http-exception.filter.ts:23-37`

The exception filter correctly hides stack traces for non-HTTP exceptions (returning generic "Internal server error"). However, HTTP exceptions pass through user-provided `message` fields directly. Verify that no internal details leak through custom exception messages.

**Status:** Low risk — the pattern is standard in NestJS and messages are developer-controlled.

#### L4: Raw SQL Queries Use Parameterized Templates

**File:** `apps/api/src/invoices/invoices.service.ts:257-274`

Raw SQL queries using `$queryRaw` with tagged template literals are safe (Prisma parameterizes them automatically). This is the correct pattern — just noting for awareness.

**Status:** No action needed.

#### L5: `unsafe-inline` in CSP `style-src`

**File:** `apps/api/src/main.ts:95`

The Content Security Policy allows `'unsafe-inline'` for styles. This is common for React/Next.js apps that use CSS-in-JS but weakens XSS protection for style injection attacks.

**Recommendation:** Consider using nonces or hashes for inline styles if feasible.

#### L6: Health Endpoint Missing `@Public()` Decorator

**File:** `apps/api/src/health.controller.ts:5-6`

The health controller has `@SkipThrottle()` but no `@Public()` decorator. It works because the `AuthGuard` is not applied globally (it's per-controller), but this is inconsistent with other public endpoints and could break if the guard application strategy changes.

**Recommendation:** Add `@Public()` decorator for explicitness.

#### L7: Caddyfile Missing Security Headers

**File:** `docker/Caddyfile:1-15`

The reverse proxy Caddyfile does not set standard security headers: `Strict-Transport-Security` (HSTS), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, or `Permissions-Policy`. While the API sets some via Helmet, the Next.js frontend has no security headers configured in `next.config.ts` either.

**Recommendation:** Add security headers in the Caddyfile `header` directive or in `next.config.ts`:
```
header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
}
```

#### L8: PostgreSQL Port Exposed to Host in Production Compose

**File:** `docker-compose.yml:9`

The production Docker Compose file maps PostgreSQL port `5432` to the host. This is unnecessary when only the API container needs DB access over the Docker network, and increases attack surface.

**Recommendation:** Remove the `ports` mapping for postgres in production, or bind to localhost only (`127.0.0.1:5432:5432`).

#### L9: No `.dockerignore` for Sensitive Files

**File:** `docker/api.Dockerfile:17`

The `COPY . .` in the build stage copies the entire project context. Verify a `.dockerignore` exists and excludes `.env`, `.git`, `node_modules`, and test fixtures.

**Status:** Confirmed `.dockerignore` exists and excludes `.env`, `.git`, `node_modules`.

---

## Positive Security Controls

| Control | Status | Location |
|---------|--------|----------|
| Authentication guard on all routes | Implemented | `app.module.ts`, `auth.guard.ts` |
| Role-based access control | Implemented | `roles.guard.ts`, `@Roles()` decorator |
| CSRF protection (double-submit) | Implemented | `csrf.guard.ts` |
| Input validation (whitelist + forbidNonWhitelisted) | Implemented | `main.ts:112-118` |
| Helmet CSP headers | Implemented | `main.ts:89-105` |
| CORS single-origin lock | Implemented | `main.ts:107-110` |
| Rate limiting (100 req/min global, 5/min for signup) | Implemented | `app.module.ts:52`, `onboarding.controller.ts:33` |
| File extension blocklist | Implemented | `files.service.ts:25-28` |
| Filename sanitization | Implemented | `common/utils/sanitize.ts` |
| Path traversal prevention (filename level) | Implemented | `sanitize.ts:8` |
| Secrets encrypted at rest (AES-256-GCM) | Implemented | `settings.service.ts` |
| API key masking in responses | Implemented | `settings.service.ts` |
| Auth secret validation at startup | Implemented | `main.ts:39-66` |
| Stack trace hiding | Implemented | `http-exception.filter.ts` |
| Docker non-root user | Implemented | `api.Dockerfile:36`, `web.Dockerfile:25` |
| Multi-stage Docker builds | Implemented | Both Dockerfiles |
| Webhook signature verification | Implemented | `webhook.controller.ts:41-44` |
| Organization-scoped data access | Implemented | All service files |
| Project access assertions | Implemented | `assert-project-access.ts` |
| No hardcoded production secrets | Confirmed | `.gitignore`, env validation |
| GitHub Actions uses repository secrets | Confirmed | `.github/workflows/deploy.yml` |

---

## Recommendations Summary (Priority Order)

1. **[HIGH]** Add path traversal check in `LocalStorage.getFilePath()`
2. **[MEDIUM]** Apply `BLOCKED_EXTENSIONS` check to updates attachment uploads
3. **[MEDIUM]** Bound session cache size with LRU eviction
4. **[MEDIUM]** Bind CSRF tokens to sessions cryptographically
5. **[MEDIUM]** Restrict `trust proxy` to specific depth
6. **[MEDIUM]** Rate-limit health endpoint instead of skipping throttle
7. **[MEDIUM]** Parameterize Docker Compose credentials via env vars
8. **[LOW]** Add security headers to Caddyfile (HSTS, X-Content-Type-Options, etc.)
9. **[LOW]** Remove PostgreSQL port exposure from production Docker Compose
10. **[LOW]** Add magic byte validation for file uploads
11. **[LOW]** Derive logo extension from MIME type
12. **[LOW]** Add `@Public()` to health endpoint for consistency
13. **[LOW]** Evaluate CSP nonce-based inline styles
