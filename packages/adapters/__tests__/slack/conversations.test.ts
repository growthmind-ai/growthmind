// The Slack channel walk and its envelope parsers, driven end to end through the real
// `listSlackConversations` against a fake `fetch`. No network, no mocks of the module
// under test.
//
// WHAT THESE ROWS ARE FOR
//
// The module's comments claim four properties that nothing would otherwise enforce, and
// a claim in a comment with no row behind it is the thing this repository keeps finding
// out was never true:
//
//   1. The walk is BOUNDED. A remote handing back the same cursor forever must cost a
//      fixed number of requests, not a hung web request.
//   2. HTTP 200 IS NOT SUCCESS. Slack answers `{"ok":false,"error":…}` with a 200, and
//      a reader that trusted the status would report an empty channel list to a founder
//      whose token is missing a scope.
//   3. ONE BAD ITEM DOES NOT ERASE THE PAGE. Parsing the array wholesale would tell a
//      founder their workspace has no channels the first time Slack returned a shape we
//      had not seen.
//   4. THE TOKEN NEVER COMES BACK. Every failure arm is a code, so there is no
//      expression through which it could.
import { describe, expect, test } from "bun:test";

import { listSlackConversations } from "../../src/slack/conversations";
import { parseSlackConversationsPage, parseSlackOAuthAccess } from "../../src/slack/envelopes";

const BOT_TOKEN = "xoxb-fixture-not-a-real-token";

/** One conversation as Slack sends it. */
const channel = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  is_channel: true,
  is_private: false,
  is_archived: false,
  ...extra,
});

/** A fake `fetch` answering from a scripted queue, recording every url it was given. */
function fakeFetch(pages: readonly unknown[]): {
  readonly fetch: typeof globalThis.fetch;
  readonly urls: readonly string[];
} {
  const urls: string[] = [];
  let next = 0;

  // `string | URL` rather than the platform's `RequestInfo`: this package type-checks
  // against `lib: ["esnext"]` with no DOM, and the subject only ever calls its fetch
  // with the string url it built itself.
  const fetch = (async (input: string | URL): Promise<Response> => {
    urls.push(typeof input === "string" ? input : input.href);
    // The LAST scripted page repeats once the queue is exhausted, which is exactly the
    // "same cursor forever" remote row 1 is about.
    const body = pages[Math.min(next, pages.length - 1)];
    next += 1;
    return Response.json(body);
  }) as unknown as typeof globalThis.fetch;

  return { fetch, urls };
}

const page = (channels: readonly unknown[], nextCursor = "") => ({
  ok: true,
  channels,
  response_metadata: { next_cursor: nextCursor },
});

describe("listSlackConversations — AD-7's live walk", () => {
  test("a single page returns its channels and costs one request", async () => {
    const { fetch, urls } = fakeFetch([page([channel("C1", "growth"), channel("C2", "general")])]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.conversations.map((c) => c.id) : []).toEqual(["C1", "C2"]);
    expect(urls.length).toBe(1);
  });

  test("the walk follows a cursor and stops when Slack sends an empty one", async () => {
    const { fetch, urls } = fakeFetch([
      page([channel("C1", "growth")], "cursor-two"),
      page([channel("C2", "general")]),
    ]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok ? result.conversations.map((c) => c.id) : []).toEqual(["C1", "C2"]);
    expect(urls.length).toBe(2);
    // The cursor travels as a query parameter on our own constant url. The remote never
    // names a host, which is why this walk needs no origin re-check.
    expect(urls[1]).toContain("cursor=cursor-two");
    expect(urls[1]?.startsWith("https://slack.com/api/conversations.list?")).toBe(true);
  });

  test("a remote that returns the same cursor forever costs a FIXED number of requests", async () => {
    // ROW 1. Without the explicit page cap this is a hung web request, not a slow one.
    const { fetch, urls } = fakeFetch([page([channel("C1", "growth")], "never-ends")]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok).toBe(true);
    expect(urls.length).toBe(5);
    // Bounded AND still useful: what was collected is returned rather than refused.
    expect(result.ok ? result.conversations.length : 0).toBe(1);
  });

  test("one conversation repeated across a cursor boundary is listed once", async () => {
    // The list is live by design, so it can change underneath the walk (D3).
    const { fetch } = fakeFetch([
      page([channel("C1", "growth")], "cursor-two"),
      page([channel("C1", "growth"), channel("C2", "general")]),
    ]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok ? result.conversations.map((c) => c.id) : []).toEqual(["C1", "C2"]);
  });

  test("HTTP 200 with ok:false is a refusal, not an empty workspace", async () => {
    // ROW 2, and the realistic one: a bot token from an app whose scopes somebody chose
    // by hand. Reading the status alone tells a founder their workspace has no channels.
    const { fetch } = fakeFetch([{ ok: false, error: "missing_scope" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "not_authorised" });
  });

  test("a throttle is retryable and is NOT retried inside the request", async () => {
    const { fetch, urls } = fakeFetch([{ ok: false, error: "ratelimited" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "call_failed" });
    // A human is waiting. The poll client's backoff is for background runs.
    expect(urls.length).toBe(1);
  });

  test("a transport fault is a named failure, never a throw", async () => {
    const fetch = (() => Promise.reject(new Error("dns"))) as unknown as typeof globalThis.fetch;

    await expect(listSlackConversations({ botToken: BOT_TOKEN }, { fetch })).resolves.toEqual({
      ok: false,
      code: "call_failed",
    });
  });

  test("an unreadable body is call_failed rather than a claim about the token", async () => {
    // A captive portal's html page. We do not know what happened, and "reconnect your
    // workspace" would be telling somebody to fix a thing we have no evidence is broken.
    const fetch = (() =>
      Promise.resolve(new Response("<html>login</html>"))) as unknown as typeof globalThis.fetch;

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "call_failed" });
  });

  test("no failure arm can carry the bot token", async () => {
    // ROW 4. Structural: the arm is `{ ok: false, code }` and nothing else.
    const { fetch } = fakeFetch([{ ok: false, error: "invalid_auth" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    expect(Object.keys(result)).toEqual(["ok", "code"]);
  });
});

describe("parseSlackConversationsPage — the boundary, D5", () => {
  test("one unreadable item does not erase the page", () => {
    // ROW 3. `z.array(itemSchema)` would return nothing here, and the founder would be
    // told a workspace full of channels has none.
    const parsed = parseSlackConversationsPage(
      page([channel("C1", "growth"), { id: "C2" }, channel("C3", "general")]),
    );

    expect(parsed?.ok).toBe(true);
    expect(parsed?.ok === true ? parsed.value.conversations.map((c) => c.id) : []).toEqual([
      "C1",
      "C3",
    ]);
  });

  test("an empty next_cursor is the end of the walk, not a cursor", () => {
    // Slack signals the last page with `""`, not by omitting the field. Reading the
    // empty string as a cursor re-requests page one forever.
    expect(parseSlackConversationsPage(page([]))?.ok === true).toBe(true);
    const parsed = parseSlackConversationsPage(page([]));
    expect(parsed?.ok === true ? parsed.value.nextCursor : "unset").toBeNull();
  });

  test("absent flags are null rather than false", () => {
    // Slack sets these per conversation type. Reading an absent flag as `false` asserts
    // something the vendor never said, and the ordering policy branches on the
    // difference.
    const parsed = parseSlackConversationsPage({ ok: true, channels: [{ id: "C1", name: "g" }] });
    const first = parsed?.ok === true ? parsed.value.conversations[0] : undefined;

    expect(first?.isMember).toBeNull();
    expect(first?.isArchived).toBeNull();
  });

  test("a body that is not a Slack envelope is null, never a refusal", () => {
    // Three outcomes, not two: `null` is "we could not read this", which must not be
    // reported to a founder as "Slack refused you".
    for (const body of [null, undefined, "<html>", 42, [], { channels: [] }]) {
      expect(parseSlackConversationsPage(body)).toBeNull();
    }
  });

  test("ok:true with no channels array is null, not an empty workspace", () => {
    expect(parseSlackConversationsPage({ ok: true })).toBeNull();
  });
});

describe("parseSlackOAuthAccess — the boundary, D5", () => {
  const grant = {
    ok: true,
    access_token: "xoxb-granted",
    team: { id: "T1", name: "Fixture workspace" },
  };

  test("a grant yields the three facts the connection row needs", () => {
    expect(parseSlackOAuthAccess(grant)).toEqual({
      ok: true,
      value: { accessToken: "xoxb-granted", teamId: "T1", teamName: "Fixture workspace" },
    });
  });

  test("a missing team NAME degrades to undefined rather than losing the credential", () => {
    // The name is what a sentence renders; the token is what delivery depends on.
    // Refusing the install over the label would trade the second for the first.
    const parsed = parseSlackOAuthAccess({ ...grant, team: { id: "T1" } });

    expect(parsed).toEqual({
      ok: true,
      value: { accessToken: "xoxb-granted", teamId: "T1", teamName: undefined },
    });
  });

  test("a success claim with no token is null, never a grant with an empty token", () => {
    expect(parseSlackOAuthAccess({ ok: true, team: { id: "T1" } })).toBeNull();
    expect(parseSlackOAuthAccess({ ...grant, access_token: "" })).toBeNull();
    expect(parseSlackOAuthAccess({ ...grant, team: {} })).toBeNull();
  });

  test("Slack's own refusal is reported as a refusal", () => {
    expect(parseSlackOAuthAccess({ ok: false, error: "invalid_code" })).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  test("a {ok:false} body with no error string still lands somewhere named", () => {
    expect(parseSlackOAuthAccess({ ok: false })).toEqual({ ok: false, error: undefined });
  });
});
