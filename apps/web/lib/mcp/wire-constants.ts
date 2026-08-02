export const MCP_PROTOCOL_ERA_TARGET = "2026-07-28";

export const MCP_PROTOCOL_LEGACY_FLOOR = "2025-11-25";

export const MCP_HEADER = {
  SESSION_ID: "mcp-session-id",
  PROTOCOL_VERSION: "mcp-protocol-version",
  ORIGIN: "origin",
  CONTENT_TYPE: "content-type",
} as const;

export const JSON_RPC_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
} as const;
