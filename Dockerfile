# Multi-stage Dockerfile for the Feature Tracker Vite + React + TS SPA.
#
# Stage 1 (deps): install all dependencies in a single layer so a package.json
#   change re-uses the cache for the (larger) node_modules download.
# Stage 2 (build): tsc -b && vite build — produces a static SPA in dist/.
# Stage 3 (runtime): serve dist/ with nginx on port 8080 (the conventional
#   Cloud Run / distroless-friendly port). Nginx config rewrites unknown
#   paths to /index.html so client-side routing works on a refresh.
#
# Build context: project root.
# Image tags: ${IMAGE_TAG} is supplied at build time by Cloud Build.

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
ARG VITE_BLOCKS_OIDC_URL
ARG VITE_BLOCKS_OIDC_CLIENT_ID
ARG VITE_BLOCKS_OIDC_SCOPE
ARG VITE_BLOCKS_APP_DOMAIN
ENV VITE_BLOCKS_API_URL=$VITE_BLOCKS_API_URL \
    VITE_BLOCKS_OIDC_URL=$VITE_BLOCKS_OIDC_URL \
    VITE_BLOCKS_OIDC_CLIENT_ID=$VITE_BLOCKS_OIDC_CLIENT_ID \
    VITE_BLOCKS_OIDC_SCOPE=$VITE_BLOCKS_OIDC_SCOPE \
    VITE_BLOCKS_APP_DOMAIN=$VITE_BLOCKS_APP_DOMAIN

RUN npm run build

# ---------- 3. Runtime (nginx, static SPA) ----------
FROM nginx:1.27-alpine AS runtime

# Replace the default nginx site with one that:
#   * serves /usr/share/nginx/html on port 8080
#   * falls back to /index.html for unknown paths (SPA client routing —
#     a hard refresh on /projects/:id/dev would otherwise 404)
#   * never lets nginx cache index.html (so deploys pick up new bundles)
#   * gzip-serves text assets
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static assets only — no source, no node_modules.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# nginx's stock entrypoint is fine; it reads the default.conf we copied in.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/ > /dev/null || exit 1
