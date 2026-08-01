import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

import { POSTHOG_PROXY_PATH, resolvePostHogHosts } from "./lib/posthog-hosts";

// The workspace-root .env is loaded in instrumentation.ts for request handlers. See the
// note there for why that load cannot serve them from here. But `allowedDevOrigins` below
// is consumed at config-evaluation time, which is *before* instrumentation runs — so the
// same file must also be loaded here, for this process only. `loadEnvConfig` never
// overwrites variables already in process.env, so a real deployment environment still
// wins.
//
// `forceReload` is the load-bearing argument. Next calls `loadEnvConfig(dir)` itself
// before it evaluates this file, with dir = apps/web — which holds no .env — and
// @next/env memoises that first call process-wide. Without forcing, the call below is a
// silent no-op: it returns the cached (empty) result, ALLOWED_DEV_ORIGINS stays unset,
// and `allowedDevOrigins` degrades to []. Next then blocks /_next/webpack-hmr from the
// tunnel host, the dev runtime never boots, and every page renders as inert server HTML
// that hydrates for nobody — with no error anywhere, because an unset variable is
// indistinguishable from a deliberately unset one.
//
// The root is resolved from THIS FILE rather than cwd. Next compiles this config to
// `next.config.compiled.js` beside it, so `import.meta.url` still lands in apps/web.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvConfig(workspaceRoot, process.env.NODE_ENV !== "production", undefined, true);

// Comma-separated hosts allowed to reach dev-only resources (/_next/*, HMR) cross-origin
// — e.g. a personal tunnel domain, which is why the value lives in the gitignored .env
// rather than here. Next matches hosts, not URLs, so schemes and trailing slashes are
// tolerated and stripped. Unset leaves Next's same-origin default; production ignores it.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) =>
    origin
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, ""),
  )
  .filter((origin) => origin.length > 0);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),

  // Workspace packages ship TypeScript source (their exports point at src/*.ts), so
  // Next must transpile them.
  transpilePackages: ["@growthmind/db", "@growthmind/shared"],

  experimental: {
    // Run the local tsc CLI during `next build`. Required for TypeScript 7, whose
    // native compiler no longer ships the JS compiler API.
    useTypeScriptCli: true,
  },

  // The same-origin PostHog proxy. Destinations come from env so a self-hosted
  // PostHog works (all three paths collapse onto its single origin) and a US-region
  // deployment stops proxying its events into PostHog's EU cloud — both of which the
  // previously hardcoded `eu-*` hostnames got silently wrong. See lib/posthog-hosts.ts.
  //
  // Evaluated at config load, so these are baked into the built server: changing a
  // NEXT_PUBLIC_POSTHOG_* value requires a rebuild, exactly like the browser-side
  // inlining it mirrors.
  async rewrites() {
    const { apiHost, assetsHost } = resolvePostHogHosts({
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      assetsHost: process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST,
      uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    });

    return [
      {
        source: `${POSTHOG_PROXY_PATH}/static/:path*`,
        destination: `${assetsHost}/static/:path*`,
      },
      {
        source: `${POSTHOG_PROXY_PATH}/array/:path*`,
        destination: `${assetsHost}/array/:path*`,
      },
      {
        source: `${POSTHOG_PROXY_PATH}/:path*`,
        destination: `${apiHost}/:path*`,
      },
    ];
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
