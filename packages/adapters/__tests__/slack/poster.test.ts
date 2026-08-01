// The Slack `DeliveryPoster`, driven end to end through the real
// `createSlackDeliveryPoster` against a fake `fetch`. No network, no SDK, no mocks of
// the module under test.
//
// Two invariants dominate this file, and both come from the port's own doc comment
// (`packages/shared/src/delivery/poster.ts`):
//
// 1. Never throws. The caller is a worker task whose obligation is that a
//  delivery failure leaves persisted pipeline state intact. One escaping
//  throw makes that obligation something a human has to remember instead of
//  something the type system holds.
// 2. Slack's own error text never reaches `message`. The inherited obligation
//  the port states in words; `../../src/slack/errors.ts` meets it
//  structurally, and the named test below proves it.
import { describe, expect, test } from "bun:test";

import { isRetryablePostFailure, postResultSchema } from "@growthmind/shared";
import type { PostRequest, PostResult } from "@growthmind/shared";

import { SLACK_POST_MESSAGE_URL } from "../../src/slack/constants";
import { POST_FAILURE_MESSAGES } from "@growthmind/shared";
import { createSlackDeliveryPoster } from "../../src/slack/poster";
import {
  AD_SLACK_BOT_TOKEN,
  AD_SLACK_CHANNEL_ID,
  AD_SLACK_CONFIG,
  AD_SLACK_REQUEST,
  AD_SLACK_TS,
  createBrokenResponseFetch,
  createFakeSlackFetch,
  type FakeSlackResponseSpec,
} from "./fixtures";

const AD_SLACK_OK_BODY = {
  ok: true,
  channel: AD_SLACK_CHANNEL_ID,
  ts: AD_SLACK_TS,
  message: { type: "message", text: "ad-fake finding body" },
};

/** Runs the real poster against one canned response. */
async function postAgainst(spec: FakeSlackResponseSpec, request: PostRequest = AD_SLACK_REQUEST) {
  const fake = createFakeSlackFetch(spec);
  const poster = createSlackDeliveryPoster(AD_SLACK_CONFIG, { fetch: fake.fetch });
  const result = await poster.post(request);
  return { result, requests: fake.requests };
}

/** Every result must satisfy the port's own schema, including the failure arm, whose
 * `message` is `.min` and whose `messageRef` is `.min`. */
function expectPortValid(result: PostResult): void {
  expect(postResultSchema.safeParse(result).success).toBe(true);
}

describe("createSlackDeliveryPoster", () => {
  test("a successful post returns Slack's ts as the messageRef", async () => {
    const { result } = await postAgainst({ status: 200, json: AD_SLACK_OK_BODY });

    expect(result).toEqual({ ok: true, messageRef: AD_SLACK_TS });
    expectPortValid(result);
  });

  test("the request posts the channel, the blocks and the fallback text to chat.postMessage as a bearer call", async () => {
    const { requests } = await postAgainst({ status: 200, json: AD_SLACK_OK_BODY });

    expect(requests.length).toBe(1);
    const sent = requests[0];
    expect(sent?.url).toBe(SLACK_POST_MESSAGE_URL);
    expect(sent?.method).toBe("POST");
    expect(sent?.authorization).toBe(`Bearer ${AD_SLACK_BOT_TOKEN}`);
    expect(sent?.contentType).toContain("application/json");

    const body: unknown = JSON.parse(sent?.body ?? "");
    expect(body).toEqual({
      channel: AD_SLACK_CHANNEL_ID,
      blocks: AD_SLACK_REQUEST.blocks,
      // Never omitted: a blocks-only message is silent in a notification preview and to
      // a screen reader.
      text: AD_SLACK_REQUEST.fallbackText,
    });
  });

  test("an HTTP 200 carrying ok:false is a failure, not a success", async () => {
    // The classic bug against this API: Slack signals a refusal in a 200 body.
    const { result } = await postAgainst({
      status: 200,
      json: { ok: false, error: "channel_not_found" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("channel_unavailable");
    expect(isRetryablePostFailure(result.code)).toBe(false);
    expectPortValid(result);
  });

  test("an HTTP 429 with Retry-After is a retryable call_failed, and the adapter does not sleep on it", async () => {
    const { result, requests } = await postAgainst({
      status: 429,
      headers: { "retry-after": "30" },
      json: { ok: false, error: "ratelimited" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
    expect(isRetryablePostFailure(result.code)).toBe(true);
    expectPortValid(result);

    // Exactly one attempt. An adapter that backed off internally would sleep through
    // the worker job's own claim. The / hazard `../../src/posthog/client.ts` documents.
    // Pacing belongs to the scheduler.
    expect(requests.length).toBe(1);
  });

  test("an HTTP 500 is a retryable call_failed", async () => {
    const { result } = await postAgainst({
      status: 500,
      json: { ok: false, error: "internal_error" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
    expect(isRetryablePostFailure(result.code)).toBe(true);
  });

  test("a body that is not JSON at all fails without throwing", async () => {
    // A proxy's HTML error page, an empty body, and a body that parses to the wrong
    // shape entirely. None of these is readable as either outcome, so all three are
    // "the call did not complete" rather than a guess.
    const bodies: readonly string[] = [
      "<!doctype html><html><body>502 Bad Gateway</body></html>",
      "",
      "ok",
      "[1,2,3]",
      '{"ok":"true","ts":"1753900000.000100"}',
    ];

    for (const text of bodies) {
      const { result } = await postAgainst({ status: 200, text });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("call_failed");
      expectPortValid(result);
    }
  });

  test("fetch rejecting outright fails without throwing", async () => {
    const { result } = await postAgainst({ networkError: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
    expect(isRetryablePostFailure(result.code)).toBe(true);
    expectPortValid(result);
  });

  test("a request aborted by the timeout fails without throwing", async () => {
    const { result } = await postAgainst({ timeout: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
    expectPortValid(result);
  });

  test("a response whose own accessors throw fails without throwing", async () => {
    for (const broken of ["headers", "text"] as const) {
      const poster = createSlackDeliveryPoster(AD_SLACK_CONFIG, {
        fetch: createBrokenResponseFetch(broken),
      });
      const result = await poster.post(AD_SLACK_REQUEST);

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("call_failed");
      expectPortValid(result);
    }
  });

  test("blocks that cannot be serialised are rejected and never reach the network", async () => {
    // `blocks` is `readonly unknown[]` at the port, so it can carry a circular
    // structure, and `JSON.stringify` throws on one. The port may not.
    const circular: Record<string, unknown> = { type: "section" };
    circular.self = circular;

    const { result, requests } = await postAgainst(
      { status: 200, json: AD_SLACK_OK_BODY },
      { ...AD_SLACK_REQUEST, blocks: [circular] },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("rejected");
    expect(isRetryablePostFailure(result.code)).toBe(false);
    expectPortValid(result);

    // No socket was opened for a payload we could not even build.
    expect(requests.length).toBe(0);
  });

  test("ok:true without a ts is a failure rather than an unusable success", async () => {
    // The port requires a non-empty `messageRef`. It is the threading key a later reply
    // is posted against, so there is no honest success to return here, and inventing a
    // ref would poison that key.
    for (const json of [{ ok: true }, { ok: true, ts: "" }]) {
      const { result } = await postAgainst({ status: 200, json });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("call_failed");
      expectPortValid(result);
    }
  });

  test("ok:true on a non-2xx status is not read as success", async () => {
    const { result } = await postAgainst({ status: 503, json: AD_SLACK_OK_BODY });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
  });

  test("no Slack-supplied text reaches the returned message, whatever identifying detail the response carries", async () => {
    // The redaction test. A Slack refusal stuffed with every kind of identifying detail
    // a real one can carry: workspace, channel, bot user, request id, scope names, and
    // a full human-readable sentence. The port's inherited obligation is that none of
    // it comes back out.
    const hostileBody = {
      ok: false,
      error: "channel_not_found",
      detail: "channel C0ADFAKECHANNEL in team T0ADFAKETEAM is not visible to bot U0ADFAKEBOTUSER",
      needed: "channels:write",
      provided: "chat:write",
      warning: "missing_charset",
      response_metadata: {
        messages: ["[ERROR] channel C0ADFAKECHANNEL not found (request ad-fake-request-8f21c)"],
        request_id: "ad-fake-request-8f21c",
        team_id: "T0ADFAKETEAM",
      },
    };

    const { result } = await postAgainst({ status: 200, json: hostileBody });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("channel_unavailable");

    const identifying: readonly string[] = [
      "C0ADFAKECHANNEL",
      "T0ADFAKETEAM",
      "U0ADFAKEBOTUSER",
      "ad-fake-request-8f21c",
      "channels:write",
      "chat:write",
      "missing_charset",
      "channel_not_found",
      "[ERROR]",
      hostileBody.detail,
    ];
    for (const fragment of identifying) {
      expect(result.message).not.toContain(fragment);
    }

    // The strongest form of the assertion: the message is not merely scrubbed, it is
    // one of exactly four hand-written sentences. Slack's bytes have no path to it at
    // all.
    expect(Object.values(POST_FAILURE_MESSAGES)).toContain(result.message);
  });

  test("the bot token never appears in a returned message, on any path", async () => {
    // Belt and braces on the credential specifically: it is the one value in this
    // adapter whose leak would cost a customer their workspace.
    const specs: readonly FakeSlackResponseSpec[] = [
      { status: 200, json: { ok: false, error: "invalid_auth" } },
      { status: 401, json: { ok: false, error: "not_authed" } },
      { status: 200, text: `token ${AD_SLACK_BOT_TOKEN} was rejected` },
      { networkError: true },
    ];

    for (const spec of specs) {
      const { result } = await postAgainst(spec);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).not.toContain(AD_SLACK_BOT_TOKEN);
      expect(result.message).not.toContain("xoxb");
      expect(result.message).not.toContain("Bearer");
    }
  });

  test("the poster never throws and always returns a port-valid result, for every response shape in this suite", async () => {
    // The `NEVER THROWS` contract as a sweep rather than as a per-case assertion, so a
    // shape added here is covered by construction.
    const specs: readonly FakeSlackResponseSpec[] = [
      { status: 200, json: AD_SLACK_OK_BODY },
      { status: 200, json: { ok: false, error: "is_archived" } },
      { status: 200, json: { ok: false } },
      { status: 200, json: null },
      { status: 200, json: [] },
      { status: 200, text: "" },
      { status: 200, text: "<html>nope</html>" },
      { status: 204, text: "" },
      { status: 302, headers: { location: "https://ad-fake.invalid/elsewhere" }, text: "" },
      { status: 400, json: { ok: false, error: "invalid_blocks" } },
      { status: 401, json: { ok: false, error: "token_revoked" } },
      { status: 429, json: { ok: false, error: "ratelimited" } },
      { status: 500, text: "upstream connect error" },
      { status: 503, json: { ok: false, error: "service_unavailable" } },
      { networkError: true },
      { timeout: true },
    ];

    for (const spec of specs) {
      const { result } = await postAgainst(spec);
      expectPortValid(result);
      if (!result.ok) {
        expect(Object.values(POST_FAILURE_MESSAGES)).toContain(result.message);
      }
    }
  });

  test("a body larger than the response ceiling is not read as either outcome", async () => {
    // A hostile or broken upstream cannot make this adapter hold an unbounded body in
    // memory, and an over-long body is never guessed at.
    const { result } = await postAgainst({
      status: 200,
      text: `{"ok":true,"ts":"${AD_SLACK_TS}","pad":"${"x".repeat(70_000)}"}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("call_failed");
  });
});
