/**
 * Next auto-loads `.env` from its own project root (apps/web), but this is a
 * monorepo and the single `.env` lives at the workspace root — the worker and
 * scripts/* read that same file, and duplicating secrets per app is how they
 * drift. Without this, nothing in it ever reaches the server.
 *
 * That failed silently rather than loudly: every variable the app strictly
 * needs has a dev default in packages/shared/src/env.ts, so the app booted
 * fine on defaults. Only the optional ones went missing — BETTER_AUTH_API_KEY,
 * ANTHROPIC_API_KEY, POSTHOG_* — each degrading to "feature not configured"
 * with no error anywhere. The Better Auth dash plugin was the first thing to
 * make it visible: its endpoints simply never registered, so ownership
 * verification 404'd.
 *
 * This belongs in `instrumentation.ts`, not `next.config.ts`: under Turbopack
 * the config is evaluated in a separate process from the one that serves
 * routes, so mutating `process.env` there does not reach request handlers
 * (verified — a probe route still read `undefined`). `register()` runs once in
 * the server runtime before any request is handled, which is early enough for
 * the lazy `getAuth()` / `parseServerEnv()` reads.
 *
 * `loadEnvConfig` never overwrites a variable already present in process.env,
 * so real deployment environment (Vercel, docker compose) still wins.
 *
 * Caveat: this cannot cover `NEXT_PUBLIC_*` variables, which the bundler
 * inlines at build time, before any of this runs. Those still need to be set
 * in the build environment.
 *
 * The imports are dynamic and live inside the runtime guard on purpose: this
 * module is compiled for the Edge runtime too, and a top-level `node:path` /
 * `@next/env` import makes that compilation fail ("A Node.js module is loaded
 * which is not supported in the Edge Runtime"). Behind the `await import`, the
 * Edge bundle never reaches them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ default: path }, { loadEnvConfig }] = await Promise.all([
    import("node:path"),
    import("@next/env"),
  ]);

  loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production");
}
