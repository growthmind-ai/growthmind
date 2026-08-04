import type { WebEnv } from "@growthmind/shared";

export const MCP_ROUTE_PATH = "/api/mcp";

// The twin of `lib/slack/oauth.ts`'s callback derivation, and the same guard for a
// sharper reason: this address is pasted into a founder's config file beside a
// credential, so a caller-supplied one would exfiltrate the key rather than merely
// redirect. Configuration is the only input.
export function mcpPublicUrl(env: WebEnv): string {
  return new URL(MCP_ROUTE_PATH, env.BETTER_AUTH_URL).href;
}
