import { apiKeyIdOf, resolveApiKeyPrincipal, stampApiKeyUse, type ScopedDb } from "@growthmind/db";
import { logger, type TenantContext } from "@growthmind/shared";

export interface McpCredential {
  readonly context: TenantContext;
}

export interface McpCredentialSource {
  resolve(presented: string): Promise<McpCredential | null>;
}

export type ApiKeyUseStamp = (db: ScopedDb, keyId: string) => Promise<void>;

// A parameter with a production default, so a stamp fault and a credential-store
// fault have separate injection points and the two D8 halves stop contradicting.
export function createApiKeyMcpCredentials(
  db: ScopedDb,
  stamp: ApiKeyUseStamp = stampApiKeyUse,
): McpCredentialSource {
  return {
    async resolve(presented: string): Promise<McpCredential | null> {
      const context = await resolveApiKeyPrincipal(db, presented);
      if (context === null) return null;

      const keyId = apiKeyIdOf(context);
      if (keyId !== null) {
        // One frame below `authenticate`'s catch in server.ts, where null IS the 401:
        // a stamp fault is caught here and can never be read as a refused credential.
        // A resolver fault is not caught here at all, and refuses exactly as before.
        try {
          await stamp(db, keyId);
        } catch (error) {
          logger.error("mcp: the key was accepted and its last-used stamp was not written", {
            error,
          });
        }
      }

      return { context };
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
