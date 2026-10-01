# Cloud Build setup

This repo ships with `cloudbuild.yaml` and `Dockerfile` at the project
root. To get a working deploy, configure a Cloud Build trigger with the
following settings.

## Trigger configuration

| Field | Value |
|---|---|
| Source | Connect this GitHub repo on `pre-dev` (or `^main$` for prod) |
| Configuration type | **Cloud Build configuration file (yaml or json)** |
| Configuration location | `cloudbuild.yaml` |
| Service account | Needs `roles/artifactregistry.writer` (+ `roles/run.admin` if you want auto-deploy) |

> **Do not** use the "Dockerfile" configuration type — that runs kaniko
> directly with a `--dockerfile <path>` flag, and the path it expects
> (typically the project's default) will not match the `Dockerfile` at
> this repo's root. That's exactly what produces the
> `error resolving dockerfile path` failure.

## Required substitutions

Set these on the trigger's "Substitutions" panel. The `_` prefix is the
Cloud Build convention for user-set variables. **Do not commit real
values** — set them only in the trigger's substitution panel. The values
in this repo's local `.env` (which is `.gitignore`d) are yours to copy
from at trigger-creation time, then never again.

| Substitution | Where the value lives |
|---|---|
| `_VITE_BLOCKS_API_URL` | From `.env` → `VITE_BLOCKS_API_URL` |
| `_VITE_BLOCKS_KEY` | From `.env` → `VITE_BLOCKS_KEY` (tenant key) |
| `_VITE_BLOCKS_OIDC_CLIENT_ID` | From `.env` → `VITE_BLOCKS_OIDC_CLIENT_ID` |
| `_VITE_BLOCKS_OIDC_URL` | From `.env` → `VITE_BLOCKS_OIDC_URL` |
| `_VITE_BLOCKS_APP_DOMAIN` | From `.env` → `VITE_BLOCKS_APP_DOMAIN` |
| `_VITE_BLOCKS_OIDC_SCOPE` | Already defaulted in `cloudbuild.yaml` to `openid profile` |
| `_REGION` | Already defaulted to `us-central1` |
| `_REPOSITORY` | Already defaulted to `feature-tracker` |
| `_SERVICE` | *(optional)* Cloud Run service name. If unset, the build stops after pushing the image. |

## What the pipeline does

```
install (npm ci) → typecheck (tsc) → build (vite build) → image (docker build) → push → [deploy]
```

1. **`install`** — `npm ci` (uses `package-lock.json`)
2. **`typecheck`** — `tsc --noEmit` (fails fast on type errors)
3. **`build`** — `npm run build` with VITE_BLOCKS_* env set; produces `dist/`
4. **`image`** — `docker build` with VITE_BLOCKS_* as `--build-arg`; the multi-stage Dockerfile produces a small nginx image serving `dist/`
5. **push** — to Artifact Registry at `${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPOSITORY}/feature-tracker:<branch>-<sha>-<build-id>`
6. **`deploy`** — only if `_SERVICE` is set: `gcloud run deploy`

## Tag format

`${BRANCH_NAME##*/}-${SHORT_SHA}-${BUILD_ID}`

For `pre-dev`, that's e.g. `pre-dev-abc1234-5e67f89a-b123-c456-d789-e012f3456789`.

## Local equivalent

To run the same build locally (requires Docker), copy values from your
local `.env` first (don't paste them into shell history in shared
environments):

```bash
set -a; source .env; set +a
docker build \
  --build-arg VITE_BLOCKS_API_URL \
  --build-arg VITE_BLOCKS_KEY \
  --build-arg VITE_BLOCKS_OIDC_CLIENT_ID \
  --build-arg VITE_BLOCKS_OIDC_URL \
  --build-arg VITE_BLOCKS_OIDC_SCOPE \
  --build-arg VITE_BLOCKS_APP_DOMAIN \
  -t feature-tracker:dev \
  .
```

Then `docker run -p 8080:8080 feature-tracker:dev`.
