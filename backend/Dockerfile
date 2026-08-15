# Wingcaster backend — multi-stage production image.
#
# Build context is the repo ROOT (Railway ignores `buildContext` in
# railway.json for this project), so every COPY prefixes `backend/`.
#
# Stage 1 (deps): install every production dependency, including native
# modules that require compilation (sharp needs libvips, better-sqlite3
# needs node-gyp + python + build tools).
#
# Stage 2 (runtime): copy only the compiled node_modules + backend app
# source into a slim base image with just the shared libraries the
# natives need at runtime. Runs as a non-root user under tini for
# correct signal handling.

# ---------- deps ----------
FROM node:20-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      build-essential \
      libvips-dev \
      pkg-config \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips42 \
      tini \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 wingcaster \
 && useradd  --system --uid 1001 --gid wingcaster --shell /bin/false wingcaster

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=wingcaster:wingcaster backend/ ./

RUN mkdir -p uploads && chown -R wingcaster:wingcaster uploads

USER wingcaster

ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps"

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start.js"]
