import { run } from "graphile-worker";

import { parseServerEnv } from "@growthmind/shared";

import { crontab, taskList } from "./index";

async function main(): Promise<void> {
  const env = parseServerEnv(process.env);

  // Graphile Worker creates and migrates its own schema (graphile_worker) on startup,
  // so a fresh database needs no separate queue setup step.
  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    taskList,
    crontab,
  });

  await runner.promise;
}

main().catch((error) => {
  console.error("worker crashed", error);
  process.exit(1);
});
