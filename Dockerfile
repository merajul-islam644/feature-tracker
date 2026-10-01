# Multi-stage Dockerfile for the Feature Tracker Vite + React + TS SPA.
#
# Stage 1 (deps): install all dependencies in a single layer so a package.json
#   change re-uses the cache for the (larger) node_modules download.
# Stage 2 (build): tsc -b && vite build — produces a static SPA in dist/.
# Stage 3 (runtime): serve dist/ + /api/* via `server/prod-backend.mjs`
#   (vanilla node:http). Replaces the previous nginx-only runtime so AI
#   Chat and /api/verify/* work in production. Node built-ins only
#   (http/fs/path/zlib/crypto/stream/url) — no package.json / npm ci needed
#   at runtime; final image is ~70 MB on node:20-alpine.
#
# Build context: project root.
#
# Required build args (all VITE_BLOCKS_* — Vite inlines these into the bundle
# at build time; runtime env vars cannot replace them):
#   VITE_BLOCKS_API_URL          Blocks API gateway URL. For custom
#                                registrable domains (e.g. *.slsblx.com)
#                                this MUST be https://blocksapi.<reg-domain>
#                                so the Secure IAM session cookie lands
#                                on the same registrable domain as the app.
#   VITE_BLOCKS_KEY              Tenant key sent as `x-blocks-key`.
#   VITE_BLOCKS_OIDC_CLIENT_ID   Public OIDC client id for THIS app.
#   VITE_BLOCKS_OIDC_URL         Tenant's OIDC discovery URL:
#                                https://iam.seliseblocks.com/<tenant-id>/.well-known/openid-configuration
#   VITE_BLOCKS_OIDC_SCOPE       OAuth scopes, default `openid profile`.
#   VITE_BLOCKS_APP_DOMAIN       App domain for client metadata, e.g.
#                                https://dbeegi.slsblx.com. Required on
#                                custom (non-*.seliseblocks.com) domains.
#
# Pass via Cloud Build substitutions:
#   --build-arg VITE_BLOCKS_API_URL=...
#   --build-arg VITE_BLOCKS_KEY=...
#   --build-arg VITE_BLOCKS_OIDC_CLIENT_ID=...
#   --build-arg VITE_BLOCKS_OIDC_URL=...
#   --build-arg VITE_BLOCKS_OIDC_SCOPE=openid profile
#   --build-arg VITE_BLOCKS_APP_DOMAIN=...
#
# Or via cloudbuild.yaml:
#   args:
#     - VITE_BLOCKS_API_URL=${_VITE_BLOCKS_API_URL}
#     - VITE_BLOCKS_KEY=${_VITE_BLOCKS_KEY}
#     - ...
#
# AI gateway and verification backend use server-only (no VITE_ prefix)
# env vars. The Blocks release pipeline (`blocks release deploy
# --with-secrets .env.production`) syncs them into the repo's secret
# set, but does NOT inject them into the running container's env
# (verified: k8s deploy log shows "configured" with no env/envFrom
# lines, prod-backend.mjs returns 503 ai_not_configured). The only
# mechanism that reaches the container is build args — `release
# deploy` runs buildx with the trigger substitutions. AI_GATEWAY_* and
# VERIFY_BACKEND_URL must therefore be added as trigger substitutions
# in the Blocks portal for the dev environment. See
# `.env.production.example` for the expected shape. The runtime stage
# (Stage 3) reads these ARGs and exposes them as ENV so prod-backend
# picks them up at process start.

# ---------- 1. Dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy only what's needed to resolve deps first, so this layer is cached
# unless package.json / package-lock.json changes.
COPY package.json package-lock.json* ./
# `npm ci` fails when package-lock.json is missing or out of sync with the
# package.json; fall back to `npm install` in that case so the image still
# builds from a clean tree. The lockfile should be present in committed
# builds — the fallback exists for one-off dev builds.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------- 2. Build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Bring in node_modules from the deps stage rather than re-installing.
COPY --from=deps /app/node_modules ./node_modules
# Now bring in the rest of the source. Putting this after the COPY of
# node_modules means source-only changes don't bust the deps cache.
COPY . .

# Production build: typecheck then bundle. Cloud Build passes
# VITE_BLOCKS_* env vars in (see cloudbuild.yaml / .env.example). ARG
# defaults let the image build without them so a smoke build still works.
ARG VITE_BLOCKS_API_URL
ARG VITE_BLOCKS_KEY
ARG VITE_BLOCKS_OIDC_URL
ARG VITE_BLOCKS_OIDC_CLIENT_ID
ARG VITE_BLOCKS_OIDC_SCOPE
ARG VITE_BLOCKS_APP_DOMAIN
ENV VITE_BLOCKS_API_URL=$VITE_BLOCKS_API_URL \
    VITE_BLOCKS_KEY=$VITE_BLOCKS_KEY \
    VITE_BLOCKS_OIDC_URL=$VITE_BLOCKS_OIDC_URL \
    VITE_BLOCKS_OIDC_CLIENT_ID=$VITE_BLOCKS_OIDC_CLIENT_ID \
    VITE_BLOCKS_OIDC_SCOPE=$VITE_BLOCKS_OIDC_SCOPE \
    VITE_BLOCKS_APP_DOMAIN=$VITE_BLOCKS_APP_DOMAIN

RUN npm run build

# ---------- 3. Runtime (Node, SPA + API proxies) ----------
FROM node:20-alpine AS runtime

# WORKDIR matters: prod-backend.mjs resolves DIST_DIR from process.cwd()
# (`path.resolve(process.cwd(), "dist")`). Without WORKDIR /app the path
# would be `/dist` instead of `/app/dist` and every static route would
# 500 with `{"error":"missing_dist"}`.
WORKDIR /app

# prod-backend.mjs uses only node built-ins (http, fs, path, zlib, stream,
# url, crypto) — no package.json / npm ci needed at runtime. ~70 MB final
# image (vs ~45 MB for nginx:1.27-alpine, but the Node process is what
# makes /api/ai/chat work — without it production AI Chat returns 405).
COPY server/prod-backend.mjs /app/server/prod-backend.mjs
COPY --from=build /app/dist /app/dist

# AI gateway + verification backend env vars. These come from the
# Blocks trigger substitutions (Build → Trigger → Substitutions) — see
# the file header comment. Without these, prod-backend.mjs returns
# 503 ai_not_configured / verify_not_configured on every /api/ai/chat
# and /api/verify/* request.
ARG AI_GATEWAY_URL
ARG AI_GATEWAY_TOKEN
ARG AI_GATEWAY_MODEL
ARG VERIFY_BACKEND_URL
ENV AI_GATEWAY_URL=$AI_GATEWAY_URL \
    AI_GATEWAY_TOKEN=$AI_GATEWAY_TOKEN \
    AI_GATEWAY_MODEL=$AI_GATEWAY_MODEL \
    VERIFY_BACKEND_URL=$VERIFY_BACKEND_URL

ENV PORT=8080
EXPOSE 8080

# /api/health returns a fixed JSON 200, so the probe is unambiguously
# tied to this service (a GET / probe would return index.html and tell
# you nothing about which process answered).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/api/health > /dev/null || exit 1

CMD ["node", "/app/server/prod-backend.mjs"]
