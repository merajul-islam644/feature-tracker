# Inbound mail receiver — Cloud Run container.
# Secrets are NOT baked in: pass them at deploy time with
# `gcloud run deploy --update-env-vars` (see mail-server/README.md).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
# The server reads ../.env when present; in the container env comes from
# Cloud Run, so the missing file is expected and skipped.
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
