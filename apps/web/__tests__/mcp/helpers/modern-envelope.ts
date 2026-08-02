import { MCP_URL, WIRE_HEADERS } from "./mcp-fixture";

const MODERN_REVISION = "2026-07-28";

const PROTOCOL_VERSION_CLAIM = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_CLAIM = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_CLAIM = "io.modelcontextprotocol/clientCapabilities";

const MCP_METHOD_HEADER = "mcp-method";
const MCP_NAME_HEADER = "mcp-name";

const CLIENT_INFO = { name: "growthmind-modern-envelope", version: "0.0.0" } as const;

export interface ModernRequestInput {
  readonly method: string;

  readonly name?: string;

  readonly params?: Readonly<Record<string, unknown>>;
  readonly key?: string | null;

  readonly id?: number | string;
}

export function modernRequest(input: ModernRequestInput): Request {
  const headers = new Headers(WIRE_HEADERS);
  headers.set(MCP_METHOD_HEADER, input.method);
  if (input.name !== undefined) {
    headers.set(MCP_NAME_HEADER, input.name);
  }
  if (typeof input.key === "string") {
    headers.set("authorization", `Bearer ${input.key}`);
  }

  const params: Record<string, unknown> = {
    ...input.params,
    _meta: {
      [PROTOCOL_VERSION_CLAIM]: MODERN_REVISION,
      [CLIENT_INFO_CLAIM]: CLIENT_INFO,
      [CLIENT_CAPABILITIES_CLAIM]: {},
    },
  };

  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.id ?? 1,
      method: input.method,
      params,
    }),
  });
}

export function modernToolCallRequest(input: {
  tool: string;
  input?: unknown;
  key?: string | null;
  id?: number | string;
}): Request {
  return modernRequest({
    method: "tools/call",
    name: input.tool,
    params: { name: input.tool, arguments: input.input ?? {} },
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}
