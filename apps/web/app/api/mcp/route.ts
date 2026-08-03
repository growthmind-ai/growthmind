import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createLiveReadPort } from "@/lib/mcp/read-port-live";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function resolveMcpDeps(db: ScopedDb = getDb()): McpServerDeps {
  return {
    credentials: createApiKeyMcpCredentials(db),

    reads: createLiveReadPort(db),
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}
