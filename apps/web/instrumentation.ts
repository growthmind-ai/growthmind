export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadEnvConfig } = await import("@next/env");

  loadEnvConfig("../..", process.env.NODE_ENV !== "production");
}
