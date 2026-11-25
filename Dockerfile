# Multi-stage Dockerfile for the Feature Tracker Vite + React + TS SPA.
#
# Stage 1 (deps): install the frontend deps.
# Stage 2 (build): tsc -b && vite build — produces a static SPA in dist/.
# Stage 3 (runtime): serve dist/ + /api/* via `server/prod-backend.mjs`
#   (vanilla node:http). Single container, one Cloud Run service, no
#   portal-managed URL substitutions needed. The mcp-server child process
#   that used to run alongside was retired from the repo (b6a9bda — the
#   workspace moved into the browser + a user-local runner), so this image
#   no longer installs or spawns it; the retired /api surfaces answer with
#   prod-backend.mjs's designed 503s instead.
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

# mcp-server used to be installed here too (own package.json, tsx loader,
# python3/make/g++ for its node-pty). It was retired from the repo in
# b6a9bda and nothing in the image spawns it anymore — see the runtime
# stage's DISABLE_MCP_CHILD note. Only the frontend deps remain.

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

# ---------- 3. Runtime (Node, SPA only) ----------
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

# mcp-server used to be COPY'd in here from the deps stage and spawned by
# prod-backend.mjs on :8787. It was retired from the repo (b6a9bda), so
# nothing is copied or spawned anymore.

# AI gateway env vars. These come from the Blocks trigger substitutions
# (Build → Trigger → Substitutions) — see .env.production.example. Without
# these, prod-backend.mjs returns 503 ai_not_configured on every
# /api/ai/chat request. Note: the AI chat gateway is also reachable
# through per-user Settings headers (x-ai-gateway-*), which the SPA
# attaches on every request; these env values are vestigial fallbacks.
#
# VERIFY_BACKEND_URL + DEV_SERVER_BACKEND_URL are NOT ARGs — they are set
# empty here, which selects prod-backend.mjs's designed "not configured"
# mode: every /api/verify/*, /api/secrets, /api/evidence, /api/playwright
# and /api/dev-server/* request returns a clean 503 JSON (and the agent WS
# upgrade gets a 503) instead of hanging on a dead upstream. The mcp-server
# that used to answer on :8787 was retired from the repo (b6a9bda); point
# these at a real backend via a portal substitution only if that backend
# returns to the image.
ARG AI_GATEWAY_URL
ARG AI_GATEWAY_TOKEN
ARG AI_GATEWAY_MODEL
ENV AI_GATEWAY_URL=$AI_GATEWAY_URL \
    AI_GATEWAY_TOKEN=$AI_GATEWAY_TOKEN \
    AI_GATEWAY_MODEL=$AI_GATEWAY_MODEL

# Retired upstreams — empty selects the designed 503 mode (see above).
ENV VERIFY_BACKEND_URL="" DEV_SERVER_BACKEND_URL=""

# Local-agent bridge — opt-in. When AGENT_BRIDGE_ENABLED=1, the
# mcp-server child process forwards every /dev-server/* HTTP request
# over a WebSocket to a local agent running on the user's machine
# (see agent/agent.mjs + mcp-server/src/agentBridge.ts). Without it,
# the mcp-server runs the routes locally — same as dev mode.
#
# AGENT_BRIDGE_TOKEN is the shared secret the agent must present on
# its WS `hello` frame to be accepted. Rotate together: change the
# portal substitution, restart the user's agent with the new --token.
#
# Both must be set as Trigger substitutions in the Blocks portal
# (Build → Trigger → Substitutions) for them to reach the running
# container. See .env.production.example.
ARG AGENT_BRIDGE_ENABLED
ARG AGENT_BRIDGE_TOKEN
ENV AGENT_BRIDGE_ENABLED=$AGENT_BRIDGE_ENABLED \
    AGENT_BRIDGE_TOKEN=$AGENT_BRIDGE_TOKEN

# DISABLE_MCP_CHILD=1 skips the spawn in prod-backend.mjs. mcp-server was
# retired from the repo (b6a9bda — workspace moved into the browser + a
# user-local runner), so there is nothing to spawn: this is the production
# default now. The spawn block stays in prod-backend.mjs untouched, ready
# if a server-side workspace backend ever returns (via MCP_CHILD_* env).
ENV DISABLE_MCP_CHILD=1

ENV PORT=8080
EXPOSE 8080

# /api/health returns a fixed JSON 200, so the probe is unambiguously
# tied to this service (a GET / probe would return index.html and tell
# you nothing about which process answered).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/api/health > /dev/null || exit 1

CMD ["node", "/app/server/prod-backend.mjs"]
