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
COPY worker/package.json worker/
RUN bun install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @growthmind/web build

EXPOSE 3000

# Migrations run before the server starts, so a fresh `docker compose up`
# reaches a working app in one command with no separate setup step.
CMD ["sh", "-c", "bun run --filter @growthmind/db db:migrate && bun run --filter @growthmind/web start"]
