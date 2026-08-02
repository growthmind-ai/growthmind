import { describe, expect, test } from "bun:test";

import {
  listChannels,
  SLACK_OAUTH_SCOPES,
  SLACK_OAUTH_SCOPE_PARAM,
} from "../../lib/slack/channels";

const BOT_TOKEN = "xoxb-fixture-not-a-real-token";

const channel = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `C_${name}`,
  name,
  is_channel: true,
  is_private: false,
  is_archived: false,
  ...extra,
});

const answering = (body: unknown): typeof globalThis.fetch =>
  (() => Promise.resolve(Response.json(body))) as unknown as typeof globalThis.fetch;

const listing = (channels: readonly unknown[]) =>
  answering({ ok: true, channels, response_metadata: { next_cursor: "" } });

const namesFrom = async (fetch: typeof globalThis.fetch): Promise<readonly string[]> => {
  const result = await listChannels(BOT_TOKEN, { fetch });
  return result.ok ? result.channels.map((entry) => entry.name) : [`REFUSED:${result.code}`];
};

describe("SLACK_OAUTH_SCOPES — one statement of what this app asks for", () => {
  test("the read scopes AND the write scope are all requested", () => {
    expect([...SLACK_OAUTH_SCOPES]).toEqual(["channels:read", "groups:read", "chat:write"]);
  });

  test("the authorize parameter is DERIVED from the array, never spelled twice", () => {
    expect(SLACK_OAUTH_SCOPE_PARAM).toBe(SLACK_OAUTH_SCOPES.join(","));
  });
});

describe("listChannels — the ordering policy", () => {
  test("channels the bot has already joined come first", () => {
    return expect(
      namesFrom(
        listing([
          channel("zulu", { is_member: true }),
          channel("alpha", { is_member: false }),
          channel("mike"),
        ]),
      ),
    ).resolves.toEqual(["zulu", "mike", "alpha"]);
  });

  test("an unstated membership flag ranks between joined and known-not-joined", () => {
    return expect(
      namesFrom(
        listing([channel("alpha", { is_member: false }), channel("bravo"), channel("charlie")]),
      ),
    ).resolves.toEqual(["bravo", "charlie", "alpha"]);
  });

  test("ties break alphabetically, never by the order Slack happened to send", () => {
    return expect(
      namesFrom(listing([channel("charlie"), channel("alpha"), channel("bravo")])),
    ).resolves.toEqual(["alpha", "bravo", "charlie"]);
  });

  test("NO NAME IS SPECIAL — the ordering is not a keyword classifier", () => {
    return expect(
      namesFrom(listing([channel("random"), channel("growth"), channel("wachstum")])),
    ).resolves.toEqual(["growth", "random", "wachstum"]);
  });

  test("an archived channel is offered to nobody, whatever Slack sent", () => {
    return expect(
      namesFrom(listing([channel("alive"), channel("dead", { is_archived: true })])),
    ).resolves.toEqual(["alive"]);
  });
});

describe("listChannels — what crosses the boundary", () => {
  test("only id and name leave, never a vendor flag and never the token", () => {
    return expect(
      listChannels(BOT_TOKEN, { fetch: listing([channel("growth", { is_member: true })]) }),
    ).resolves.toEqual({ ok: true, channels: [{ id: "C_growth", name: "growth" }] });
  });

  test("an empty workspace is a successful empty list, not a refusal", () => {
    return expect(listChannels(BOT_TOKEN, { fetch: listing([]) })).resolves.toEqual({
      ok: true,
      channels: [],
    });
  });
});

describe("listChannels — two refusals, two next actions", () => {
  test("a scope the install never asked for says RECONNECT", async () => {
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "missing_scope" }),
    });

    expect(result).toEqual({ ok: false, code: "not_authorised" });
  });

  test("a revoked token says RECONNECT too", async () => {
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "token_revoked" }),
    });

    expect(result).toEqual({ ok: false, code: "not_authorised" });
  });

  test("a throttle says TRY AGAIN, and does not read as a credential problem", async () => {
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "ratelimited" }),
    });

    expect(result).toEqual({ ok: false, code: "call_failed" });
  });

  test("an error nobody has classified fails toward TRY AGAIN", async () => {
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "some_error_slack_added_last_tuesday" }),
    });

    expect(result).toEqual({ ok: false, code: "call_failed" });
  });

  test("a transport fault is a named refusal, never a throw", async () => {
    const fetch = (() => Promise.reject(new Error("dns"))) as unknown as typeof globalThis.fetch;

    await expect(listChannels(BOT_TOKEN, { fetch })).resolves.toEqual({
      ok: false,
      code: "call_failed",
    });
  });

  test("no refusal can carry the bot token", async () => {
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "invalid_auth" }),
    });

    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });
});
