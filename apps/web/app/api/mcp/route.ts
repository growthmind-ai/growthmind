import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createAbsentReadPort } from "@/lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const absentReads = createAbsentReadPort((message) => {
  console.warn(message);
});

export function resolveMcpDeps(db: ScopedDb = getDb()): McpServerDeps {
  return {
    credentials: createApiKeyMcpCredentials(db),

    reads: absentReads,
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}
