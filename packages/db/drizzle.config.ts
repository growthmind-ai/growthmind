import { defineConfig } from "drizzle-kit";

import { parseServerEnv } from "@growthmind/shared";

const env = parseServerEnv(process.env);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },

  casing: "snake_case",

  strict: true,
  verbose: true,
});
