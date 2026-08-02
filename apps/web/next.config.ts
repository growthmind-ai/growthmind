import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

import { POSTHOG_PROXY_PATH, resolvePostHogHosts } from "./lib/posthog-hosts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvConfig(workspaceRoot, process.env.NODE_ENV !== "production", undefined, true);

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

  transpilePackages: ["@growthmind/db", "@growthmind/shared"],

  experimental: {
    useTypeScriptCli: true,
  },

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

  skipTrailingSlashRedirect: true,
};

export default nextConfig;
