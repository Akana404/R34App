# syntax=docker/dockerfile:1

# --------------------------------------------------
# Dependencies
# --------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Native build dependencies for better-sqlite3
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci


# --------------------------------------------------
# Production dependencies
#
# A second install without the dev dependencies: the runner needs `next` (a
# real dependency) but none of the toolchain the build used. The build tools
# stay because better-sqlite3 falls back to compiling from source when no
# prebuilt binary exists for the target architecture.
# --------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci --omit=dev


# --------------------------------------------------
# Build
# --------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# --------------------------------------------------
# Production
# --------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# better-sqlite3 is a native module
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# SQLite database directory
RUN mkdir -p /app/data \
    && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npm", "start"]