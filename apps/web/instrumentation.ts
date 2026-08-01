/**
 * Next auto-loads `.env` from its own project root (apps/web), but this is a monorepo
 * and the single `.env` lives at the workspace root. The worker and scripts/* read that
 * same file, and duplicating secrets per app is how they drift. Without this, nothing
 * in it ever reaches the server.
 *
 * That failed silently rather than loudly: every variable the app strictly needs has a
 * dev default in packages/shared/src/env.ts, so the app booted fine on defaults. Only
 * the optional ones went missing. BETTER_AUTH_API_KEY, ANTHROPIC_API_KEY, POSTHOG_*,
 * each degrading to "feature not configured" with no error anywhere. The Better Auth
 * dash plugin was the first thing to make it visible: its endpoints simply never
 * registered, so ownership verification 404'd.
 *
 * This belongs in `instrumentation.ts`, not `next.config.ts`: under Turbopack the
 * config is evaluated in a separate process from the one that serves routes, so
 * mutating `process.env` there does not reach request handlers (verified. A probe route
 * still read `undefined`). `register()` runs once in the server runtime before any
 * request is handled, which is early enough for the lazy `getAuth()` /
 * `parseServerEnv()` reads.
 *
 * `loadEnvConfig` never overwrites a variable already present in process.env, so real
 * deployment environment (Vercel, docker compose) still wins.
 *
 * Caveat: this cannot cover `NEXT_PUBLIC_*` variables, which the bundler inlines at
 * build time, before any of this runs. Those still need to be set in the build
 * environment.
 *
 * Turbopack compiles this module for the Edge runtime as well as Node. Unconditionally,
 * whether or not the app has any Edge code, and it flags Node-only references while
 * doing so. The `NEXT_RUNTIME` guard does not help: the check is static, so a
 * `node:path` import and a `process.cwd()` call are reported even when they sit behind
 * the guard, and deferring them to a dynamic `import()` does not hide a literal
 * specifier from static analysis either.
 *
 * So this file references neither. The workspace root is passed to `loadEnvConfig` as a
 * *relative* dir: it joins that against `process.cwd()` itself, and Next is invoked
 * from apps/web, so `../..` lands on the workspace root exactly as an absolute resolve
 * would. The Node API stays inside `@next/env`, where the Edge compile does not walk.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadEnvConfig } = await import("@next/env");

  loadEnvConfig("../..", process.env.NODE_ENV !== "production");
}
