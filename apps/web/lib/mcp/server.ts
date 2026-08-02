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
  type McpRefusal,
} from "./refusals";
import { renderMcpWire } from "./wire";
import { MCP_HEADER } from "./wire-constants";

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
    const body = await readBoundedBody(request);
    if (!body.ok) {
      return refusalResponse(body.refusal);
    }

    if (opensAnArray(body.bytes)) {
      return refusalResponse(MALFORMED_BODY);
    }

    return await renderMcpWire(replayable(request, body.bytes), {
      reads: deps.reads,
      credential,
    });
  } catch (error) {
    console.error("mcp: the wire could not answer a request", error);
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
    console.error("mcp: the presented key could not be checked, so it was refused", error);
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

type BoundedBody =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly refusal: McpRefusal };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const stream = request.body;
  if (stream === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return { ok: false, refusal: BODY_TOO_LARGE };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, bytes };
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
