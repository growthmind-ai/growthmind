import type { McpCredential, McpCredentialSource } from "./credentials";
import { presentedCredential } from "./credentials";
import type { McpReadPort } from "./read-port";
import {
  BODY_TOO_LARGE,
  BROWSER_ORIGIN,
  MALFORMED_BODY,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_CONTENT_TYPE,
  WRONG_METHOD,
  refusalResponse,
} from "./refusals";
import { readBoundedBody } from "../http/bounded-body";
import { renderMcpWire } from "./wire";
import { MCP_HEADER } from "./wire-constants";

import { logger } from "@growthmind/shared";
export interface McpServerDeps {
  readonly credentials: McpCredentialSource;
  readonly reads: McpReadPort;
}

const SERVED_METHOD = "POST";
const JSON_MEDIA_TYPE = "application/json";

const MAX_BODY_BYTES = 1024 * 1024;

const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const JSON_ARRAY_OPEN = 0x5b;

export async function handleMcpRequest(request: Request, deps: McpServerDeps): Promise<Response> {
  const credential = await authenticate(request, deps.credentials);
  if (credential === null) {
    return refusalResponse(UNAUTHENTICATED);
  }

  if (request.headers.get(MCP_HEADER.ORIGIN) !== null) {
    return refusalResponse(BROWSER_ORIGIN);
  }

  if (declaresSomethingOtherThanJson(request)) {
    return refusalResponse(WRONG_CONTENT_TYPE);
  }

  if (request.method !== SERVED_METHOD) {
    return refusalResponse(WRONG_METHOD);
  }

  try {
    const body = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
      return refusalResponse(BODY_TOO_LARGE);
    }

    if (opensAnArray(body.bytes)) {
      return refusalResponse(MALFORMED_BODY);
    }

    return await renderMcpWire(replayable(request, body.bytes), {
      reads: deps.reads,
      credential,
    });
  } catch (error) {
    logger.error("mcp: the wire could not answer a request", { error });
    return refusalResponse(UNAVAILABLE);
  }
}

async function authenticate(
  request: Request,
  credentials: McpCredentialSource,
): Promise<McpCredential | null> {
  const presented = presentedCredential(request);
  if (presented === null) {
    return null;
  }

  try {
    return await credentials.resolve(presented);
  } catch (error) {
    logger.error("mcp: the presented key could not be checked, so it was refused", { error });
    return null;
  }
}

function declaresSomethingOtherThanJson(request: Request): boolean {
  const declared = request.headers.get(MCP_HEADER.CONTENT_TYPE);
  if (declared === null) {
    return false;
  }

  const mediaType = (declared.split(";")[0] ?? "").trim().toLowerCase();
  return mediaType !== JSON_MEDIA_TYPE;
}

function opensAnArray(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (JSON_WHITESPACE.has(byte)) {
      continue;
    }
    return byte === JSON_ARRAY_OPEN;
  }
  return false;
}

function replayable(request: Request, bytes: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes.byteLength === 0 ? null : bytes,
  });
}
