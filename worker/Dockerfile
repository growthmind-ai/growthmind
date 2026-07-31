# Build context is the repository root (see docker-compose.yml) — a bun
# workspace needs the whole monorepo to install. No build step: bun runs the
# worker's TypeScript directly.
FROM oven/bun:1.3.14
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/adapters/package.json packages/adapters/
COPY packages/core/package.json packages/core/
COPY worker/package.json worker/
RUN bun install --frozen-lockfile

COPY . .

# Graphile Worker migrates its own schema on startup; the app schema is
# migrated by the web container, so worker tasks may briefly retry on a
# completely fresh database. That is expected and harmless.
CMD ["bun", "run", "--filter", "@growthmind/worker", "start"]
