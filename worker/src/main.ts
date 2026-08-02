import { run } from "graphile-worker";

import { logger, parseServerEnv } from "@growthmind/shared";

import { crontab, taskList } from "./index";

async function main(): Promise<void> {
  const env = parseServerEnv(process.env);

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    taskList,
    crontab,
  });

  await runner.promise;
}

main().catch((error) => {
  logger.error("worker crashed", { error });
  process.exit(1);
});
