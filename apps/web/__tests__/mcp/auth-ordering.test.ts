import { describe, expect, test } from "bun:test";

import { UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { JSON_RPC_ERROR_CODE } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rawBodyRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

const UNPARSEABLE_BODY = '{"jsonrpc":"2.0","id":1,"method":';

const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

const UNAUTHENTICATED_FRAME = JSON.stringify({
  ok: false,
  error: { code: UNAUTHENTICATED.code, message: UNAUTHENTICATED.message },
});

describe("WIRE-O1 — an unauthenticated request whose body would crash the parser is refused cleanly before parsing", () => {
  test("answers the 401 frame byte for byte and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, null), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(401);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toBe(UNAUTHENTICATED_FRAME);

    expect(spy.organizationsAsked).toEqual([]);
  });
});

describe("WIRE-O2 — the authenticated twin of the same body fails at the parser, proving the refusal was the auth gate", () => {
  test("answers the identical body with a parse error rather than the 401 frame", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, KEY_A), deps);
    const print = await fingerprint(response);

    expect(print.body).toContain(`"code":${JSON_RPC_ERROR_CODE.PARSE_ERROR}`);

    expect(print.status).not.toBe(401);
    expect(print.body).not.toBe(UNAUTHENTICATED_FRAME);
    expect(print.body).not.toContain(UNAUTHENTICATED.message);
  });

  test("the two answers to one body differ, so the credential is what decided which came back", async () => {
    const anonymous = await fingerprint(
      await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, null), spyDeps().deps),
    );
    const authenticated = await fingerprint(
      await handleMcpRequest(rawBodyRequest(UNPARSEABLE_BODY, KEY_A), spyDeps().deps),
    );

    expect(anonymous.body).toBe(UNAUTHENTICATED_FRAME);
    expect(authenticated).not.toEqual(anonymous);
  });
});
