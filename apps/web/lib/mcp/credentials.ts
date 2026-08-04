import { resolveApiKeyPrincipal, type ScopedDb } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

export interface McpCredential {
  readonly context: TenantContext;
}

export interface McpCredentialSource {
  resolve(presented: string): Promise<McpCredential | null>;
}

export function createApiKeyMcpCredentials(db: ScopedDb): McpCredentialSource {
  return {
    async resolve(presented: string): Promise<McpCredential | null> {
      const context = await resolveApiKeyPrincipal(db, presented);

      return context === null ? null : { context };
    },
  };
}

const BEARER_PREFIX = "Bearer ";

export function presentedCredential(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const material = header.slice(BEARER_PREFIX.length);
  return material.length > 0 ? material : null;
}
