FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# Optional; analytics is normally configured at runtime. See docs/telemetry.md.
ARG NEXT_PUBLIC_TRACKERS=
ENV NEXT_PUBLIC_TRACKERS=${NEXT_PUBLIC_TRACKERS}
# Where browsers reach the API, e.g. https://api.example.com. Leave empty when
# a proxy serves /api from the app's own origin.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN bun run --filter @atrium/web build

# Production
FROM base AS runner
ENV NODE_ENV=production
# Required at runtime: INTERNAL_API_URL, the API's private address
# (e.g. http://atrium-api:3001). The server refuses to start without it.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER bun
EXPOSE 3000
CMD ["bun", "run", "apps/web/server.js"]
