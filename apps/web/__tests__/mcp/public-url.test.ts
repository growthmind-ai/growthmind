import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseWebEnv, type WebEnv } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_PATH = path.join(WEB_ROOT, "lib", "mcp", "public-url.ts");

const APP_URL = "https://app.example.com";
const DEPLOYED_MCP_URL = "https://app.example.com/api/mcp";

const SPOOFABLE_TOKENS = [
  "Request",
  "headers",
  "header",
  "host",
  "forwarded",
  "origin",
  "localhost",
] as const;

interface PublicUrlModule {
  readonly MCP_ROUTE_PATH: string;
  readonly mcpPublicUrl: (env: WebEnv) => string;
}

function sourceText(): string {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      "apps/web/lib/mcp/public-url.ts does not exist yet, so nothing derives the pasted MCP url " +
        "from BETTER_AUTH_URL (O-026 D-7).",
    );
  }
  return readFileSync(SOURCE_PATH, "utf8");
}

async function publicUrlModule(): Promise<PublicUrlModule> {
  sourceText();

  const loaded = (await import(pathToFileURL(SOURCE_PATH).href)) as Record<string, unknown>;

  const missing = ["MCP_ROUTE_PATH", "mcpPublicUrl"].filter((name) => loaded[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`apps/web/lib/mcp/public-url.ts exports no ${missing.join(" and no ")} yet.`);
  }

  return loaded as unknown as PublicUrlModule;
}

function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

function spoofableTokensIn(source: string): readonly string[] {
  const code = withoutComments(source).toLowerCase();
  return SPOOFABLE_TOKENS.filter((token) => code.includes(token.toLowerCase()));
}

function envAddressedAt(betterAuthUrl: string): WebEnv {
  return parseWebEnv({ BETTER_AUTH_URL: betterAuthUrl });
}

describe("the MCP url a founder pastes is derived from configuration, never from a caller", () => {
  test("should derive the mcp url from BETTER_AUTH_URL", async () => {
    const { mcpPublicUrl } = await publicUrlModule();

    expect(mcpPublicUrl(envAddressedAt(APP_URL))).toBe(DEPLOYED_MCP_URL);
  });

  test("should hold the served route path as the one constant both halves share", async () => {
    const { MCP_ROUTE_PATH, mcpPublicUrl } = await publicUrlModule();

    expect(MCP_ROUTE_PATH).toBe("/api/mcp");
    expect(mcpPublicUrl(envAddressedAt(APP_URL)).endsWith(MCP_ROUTE_PATH)).toBe(true);
  });

  test("should answer one address whether or not the configured value carries a trailing slash", async () => {
    const { mcpPublicUrl } = await publicUrlModule();

    expect(mcpPublicUrl(envAddressedAt(`${APP_URL}/`))).toBe(DEPLOYED_MCP_URL);
  });

  test("should print no localhost when the deployment is addressed at a real host", async () => {
    const { mcpPublicUrl } = await publicUrlModule();

    expect(mcpPublicUrl(envAddressedAt(APP_URL))).not.toContain("localhost");
  });

  test("should take the environment alone, so there is no request to take a header from", async () => {
    const { mcpPublicUrl } = await publicUrlModule();

    expect(mcpPublicUrl.length).toBe(1);
    expect(spoofableTokensIn(sourceText())).toEqual([]);
  });

  test("the spoofable-token scan does fire on a source that reads a request header", () => {
    const planted = [
      "export function mcpPublicUrl(request: Request): string {",
      '  return new URL("/api/mcp", `https://${request.headers.get("host")}`).href;',
      "}",
    ].join("\n");

    expect(spoofableTokensIn(planted)).toEqual(["Request", "headers", "header", "host"]);
    expect(spoofableTokensIn('const path = "/api/mcp";')).toEqual([]);
  });
});
