import { buildAuth } from "./auth";

/**
 * Entry point for Better Auth's schema generator only. The CLI wants a module-scope
 * `auth` instance, while runtime code goes through the lazy getAuth. Reusing buildAuth
 * keeps one source of truth for the auth config, so the generated schema can never
 * drift from what runs.
 *
 * bun run db:generate:auth
 */
export const auth = buildAuth();
