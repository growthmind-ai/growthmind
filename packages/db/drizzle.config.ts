import { defineConfig } from "drizzle-kit";

import { parseServerEnv } from "@growthmind/shared";

const env = parseServerEnv(process.env);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },
  // Must match the `casing` passed to drizzle in src/client.ts: TypeScript keys are
  // camelCase, columns without an explicit name become snake_case.
  casing: "snake_case",
  // Migrations are checked in, one per PR; `db:migrate` replays them in order.
  strict: true,
  verbose: true,
});
