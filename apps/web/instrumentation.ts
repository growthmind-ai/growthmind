export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadEnvConfig } = await import("@next/env");

  loadEnvConfig("../..", process.env.NODE_ENV !== "production");

  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { describeSchemaStatus, getSchemaStatus } = await import("@growthmind/db");
  const { logger } = await import("@growthmind/shared");
  const { getDb } = await import("./lib/db");

  try {
    const detail = describeSchemaStatus(await getSchemaStatus(getDb()));
    if (detail) {
      logger.error(`startup: ${detail}`);
    }
  } catch (error) {
    logger.error(
      "startup: database unreachable — is Postgres running? Try: docker compose up -d postgres",
      { error },
    );
  }
}
