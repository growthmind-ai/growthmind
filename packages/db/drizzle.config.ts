import { defineConfig } from "drizzle-kit";

import { parseBaseEnv } from "@growthmind/shared";

const env = parseBaseEnv(process.env);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },

  casing: "snake_case",

  strict: true,
  verbose: true,
});
