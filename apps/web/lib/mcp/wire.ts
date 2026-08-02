import { MCP_TOOLS, logger } from "@growthmind/shared";
import {
  McpServer,
  createMcpHandler,
  type CallToolRequest,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import { callTool, type McpToolOutcome } from "./call-tool";
import type { McpCredential } from "./credentials";
import type { McpReadPort } from "./read-port";
import { refusalToolResult } from "./refusals";

const SERVER_NAME = "growthmind";
const SERVER_VERSION = "0.0.0";

const TOOLS_CALL = "tools/call";

export interface McpWireDeps {
  readonly reads: McpReadPort;
  readonly credential: McpCredential;
}

export async function renderMcpWire(request: Request, deps: McpWireDeps): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(deps), {
    responseMode: "sse",
    legacy: "stateless",
    maxSubscriptions: 0,
    onerror: reportTransportFault,
  });

  try {
    return await settled(await handler.fetch(request));
  } finally {
    await handler.close();
  }
}

async function settled(response: Response): Promise<Response> {
  if (response.body === null) {
    return response;
  }

  const body = await response.text();

  return new Response(body.length === 0 ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function reportTransportFault(error: Error): void {
  logger.error("mcp: the transport reported a fault", { message: error.message });
}

function buildServer(deps: McpWireDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,

        inputSchema: asStandardSchema(tool.inputSchema),
        outputSchema: asStandardSchema(tool.outputSchema),

        annotations: { readOnlyHint: tool.readOnlyHint },
      },

      unreachableToolCallback,
    );
  }

  server.server.setRequestHandler(TOOLS_CALL, async (request: CallToolRequest) => {
    const outcome = await callTool(
      request.params.name,
      request.params.arguments ?? {},
      deps.reads,
      deps.credential,
    );
    return renderOutcome(outcome);
  });

  return server;
}

function renderOutcome(outcome: McpToolOutcome): CallToolResult {
  if (!outcome.ok) {
    return { ...refusalToolResult(outcome.refusal) };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(outcome.result) }],
    structuredContent: asStructuredContent(outcome.result),
  };
}

function unreachableToolCallback(): CallToolResult {
  return { content: [] };
}

function asStandardSchema(schema: unknown): StandardSchemaWithJSON {
  return schema as StandardSchemaWithJSON;
}

function asStructuredContent(result: unknown): Record<string, unknown> {
  return result as Record<string, unknown>;
}
