// Four properties nothing else enforces: (1) the walk is BOUNDED, (2) HTTP 200 is not
// success, (3) one bad item does not erase the page, (4) the token never comes back.
import { describe, expect, test } from "bun:test";

import { listSlackConversations } from "../../src/slack/conversations";
import { parseSlackConversationsPage, parseSlackOAuthAccess } from "../../src/slack/envelopes";

const BOT_TOKEN = "xoxb-fixture-not-a-real-token";

const channel = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  is_channel: true,
  is_private: false,
  is_archived: false,
  ...extra,
});

function fakeFetch(pages: readonly unknown[]): {
  readonly fetch: typeof globalThis.fetch;
  readonly urls: readonly string[];
} {
  const urls: string[] = [];
  let next = 0;

  const fetch = (async (input: string | URL): Promise<Response> => {
    urls.push(typeof input === "string" ? input : input.href);
    // The LAST scripted page repeats once the queue is exhausted — the "same cursor
    // forever" remote row 1 is about.
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
    expect(urls[1]).toContain("cursor=cursor-two");
    expect(urls[1]?.startsWith("https://slack.com/api/conversations.list?")).toBe(true);
  });

  test("a remote that returns the same cursor forever costs a FIXED number of requests", async () => {
    // ROW 1. Without the explicit page cap this is a hung web request, not a slow one.
    const { fetch, urls } = fakeFetch([page([channel("C1", "growth")], "never-ends")]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok).toBe(true);
    expect(urls.length).toBe(5);
    expect(result.ok ? result.conversations.length : 0).toBe(1);
  });

  test("one conversation repeated across a cursor boundary is listed once", async () => {
    const { fetch } = fakeFetch([
      page([channel("C1", "growth")], "cursor-two"),
      page([channel("C1", "growth"), channel("C2", "general")]),
    ]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result.ok ? result.conversations.map((c) => c.id) : []).toEqual(["C1", "C2"]);
  });

  test("HTTP 200 with ok:false is a refusal, not an empty workspace", async () => {
    // ROW 2. Reading the status alone tells a founder their workspace has no channels.
    const { fetch } = fakeFetch([{ ok: false, error: "missing_scope" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "not_authorised" });
  });

  test("a throttle is retryable and is NOT retried inside the request", async () => {
    const { fetch, urls } = fakeFetch([{ ok: false, error: "ratelimited" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "call_failed" });
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
    const fetch = (() =>
      Promise.resolve(new Response("<html>login</html>"))) as unknown as typeof globalThis.fetch;

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(result).toEqual({ ok: false, code: "call_failed" });
  });

  test("no failure arm can carry the bot token", async () => {
    const { fetch } = fakeFetch([{ ok: false, error: "invalid_auth" }]);

    const result = await listSlackConversations({ botToken: BOT_TOKEN }, { fetch });

    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    expect(Object.keys(result)).toEqual(["ok", "code"]);
  });
});

describe("parseSlackConversationsPage — the boundary, D5", () => {
  test("one unreadable item does not erase the page", () => {
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
    expect(parseSlackConversationsPage(page([]))?.ok === true).toBe(true);
    const parsed = parseSlackConversationsPage(page([]));
    expect(parsed?.ok === true ? parsed.value.nextCursor : "unset").toBeNull();
  });

  test("absent flags are null rather than false", () => {
    const parsed = parseSlackConversationsPage({ ok: true, channels: [{ id: "C1", name: "g" }] });
    const first = parsed?.ok === true ? parsed.value.conversations[0] : undefined;

    expect(first?.isMember).toBeNull();
    expect(first?.isArchived).toBeNull();
  });

  test("a body that is not a Slack envelope is null, never a refusal", () => {
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
