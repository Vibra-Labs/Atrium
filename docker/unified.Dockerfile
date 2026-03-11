# Grab Caddy binary from official image
FROM caddy:2-alpine AS caddy

# Base image
FROM oven/bun:1 AS base
WORKDIR /app

# Install all workspace dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/email/package.json ./packages/email/
RUN bun install --frozen-lockfile

# Build everything in one stage (shared deps between API and Web)
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Restore workspace node_modules (overwritten by COPY . . since .dockerignore excludes node_modules)
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
RUN packages/database/node_modules/.bin/prisma generate --schema=packages/database/prisma/schema.prisma
RUN bun run --filter @atrium/email build
RUN bun run --filter @atrium/api build
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_BILLING_ENABLED=true
ARG NEXT_PUBLIC_STRIPE_MODE=test
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BILLING_ENABLED=${NEXT_PUBLIC_BILLING_ENABLED}
ENV NEXT_PUBLIC_STRIPE_MODE=${NEXT_PUBLIC_STRIPE_MODE}
RUN bun run --filter @atrium/web build

# Production runner
FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install Caddy
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

# Install PostgreSQL for built-in database option
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg lsb-release curl \
    && echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-16 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/postgresql/data /run/postgresql \
    && chown -R bun:bun /var/lib/postgresql /run/postgresql

# Copy API build artifacts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/database ./packages/database
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/email ./packages/email

# Copy Web standalone output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Copy Caddy config and entrypoint
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/unified-entrypoint.sh /app/unified-entrypoint.sh
RUN chmod +x /app/unified-entrypoint.sh

# Create uploads dir (fallback for local storage)
RUN mkdir -p /app/uploads && chown -R bun:bun /app

USER bun
EXPOSE 8080
ENTRYPOINT ["/app/unified-entrypoint.sh"]
