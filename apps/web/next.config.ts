import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (their exports point at
  // src/*.ts), so Next must transpile them.
  transpilePackages: ["@growthmind/db", "@growthmind/shared"],

  experimental: {
    // Run the local tsc CLI during `next build` — required for TypeScript 7,
    // whose native compiler no longer ships the JS compiler API.
    useTypeScriptCli: true,
  },

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://eu-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
