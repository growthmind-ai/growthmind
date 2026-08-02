import { resolveApiKeyForRead, type ScopedDb } from "@growthmind/db";

export interface McpCredential {
  readonly organizationId: string;
}

export interface McpCredentialSource {
  resolve(presented: string): Promise<McpCredential | null>;
}

export function createApiKeyMcpCredentials(db: ScopedDb): McpCredentialSource {
  return {
    async resolve(presented: string): Promise<McpCredential | null> {
      const resolved = await resolveApiKeyForRead(db, presented);
      if (resolved === null) {
        return null;
      }

      return { organizationId: resolved.organizationId };
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
