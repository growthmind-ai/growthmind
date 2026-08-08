# Build context is the repository root (see docker-compose.yml) — a bun
# workspace needs the whole monorepo to install and build.
FROM oven/bun:1.3.14 AS build
WORKDIR /app

# Manifests first, so dependency installation is layer-cached and survives
# source-only changes.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/adapters/package.json packages/adapters/
COPY packages/core/package.json packages/core/
COPY worker/package.json worker/
# Dev-only tooling, copied anyway: --frozen-lockfile compares against every
# workspace bun.lock knows about, so an omitted manifest fails the install
# rather than merely leaving something out.
COPY evals/find-problems/package.json evals/find-problems/
RUN bun install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Next.js inlines NEXT_PUBLIC_* at build time, so these must arrive as build args;
# set at runtime they reach a bundle that was already compiled without them.
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_ASSETS_HOST
ARG NEXT_PUBLIC_POSTHOG_UI_HOST
ARG NEXT_PUBLIC_RRWEB_PUBLIC_KEY
ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_POSTHOG_ASSETS_HOST=$NEXT_PUBLIC_POSTHOG_ASSETS_HOST \
    NEXT_PUBLIC_POSTHOG_UI_HOST=$NEXT_PUBLIC_POSTHOG_UI_HOST \
    NEXT_PUBLIC_RRWEB_PUBLIC_KEY=$NEXT_PUBLIC_RRWEB_PUBLIC_KEY

RUN bun run --filter @growthmind/web build

EXPOSE 3000

# Migrations run before the server starts, so a fresh `docker compose up`
# reaches a working app in one command with no separate setup step.
CMD ["sh", "-c", "bun run --filter @growthmind/db db:migrate && bun run --filter @growthmind/web start"]
