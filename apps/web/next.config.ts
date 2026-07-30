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
};

export default nextConfig;
