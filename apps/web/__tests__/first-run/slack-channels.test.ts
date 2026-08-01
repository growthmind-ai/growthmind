// THE CHANNEL PICKER'S ORDERING POLICY AND ITS TWO REFUSALS (AD-7, task 4.2).
//
// The wire is the adapter's and has its own suite
// (`packages/adapters/__tests__/slack/conversations.test.ts`). What is left in
// `apps/web/lib/slack/channels.ts` is the part that is a PRODUCT decision, and every
// one of those decisions is a claim a comment makes that nothing else would enforce:
//
//   * "most plausible first" means WILL-IT-WORK, never a guess at what the founder
//     wants. The rows below pin the membership rule and — just as importantly — pin
//     that no name is treated as special, because the tempting keyword version of this
//     function is a classifier over a company's private vocabulary (D10).
//   * archived channels are offered to nobody, even though Slack was already asked to
//     exclude them. That is the vendor's promise, not ours.
//   * two refusals, because there are two different next actions: reconnect, or press
//     the button again. Collapsing them tells a founder to fix something we have no
//     evidence is broken.
//   * `{ id, name }` and nothing else leaves this boundary.
import { describe, expect, test } from "bun:test";

import {
  listChannels,
  SLACK_OAUTH_SCOPES,
  SLACK_OAUTH_SCOPE_PARAM,
} from "../../lib/slack/channels";

const BOT_TOKEN = "xoxb-fixture-not-a-real-token";

/** One conversation as Slack sends it, with the membership flag left unset unless a row
 *  cares — which is the ordinary shape, since Slack sets it per conversation type. */
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
    // `chat:write` is not padding. Scopes are granted at authorize time, so an install
    // that omits it is a completed setup that can list channels and deliver nothing —
    // and the fix is a re-consent this product has no screen for.
    expect([...SLACK_OAUTH_SCOPES]).toEqual(["channels:read", "groups:read", "chat:write"]);
  });

  test("the authorize parameter is DERIVED from the array, never spelled twice", () => {
    // Two spellings of one scope set is a workspace that connects and then lists
    // nothing, with the error on a call the founder never watches (D9).
    expect(SLACK_OAUTH_SCOPE_PARAM).toBe(SLACK_OAUTH_SCOPES.join(","));
  });
});

describe("listChannels — the ordering policy", () => {
  test("channels the bot has already joined come first", () => {
    // Posting to a public channel the bot has not joined fails with `not_in_channel`,
    // and that failure arrives on the TEST POST — after the founder believed they were
    // finished. A channel Slack says the bot is in is one the next step succeeds on.
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
    // `null` is "Slack did not say", which is not the same as "no". Treating the two
    // alike would bury every conversation type that does not carry the flag.
    return expect(
      namesFrom(
        listing([channel("alpha", { is_member: false }), channel("bravo"), channel("charlie")]),
      ),
    ).resolves.toEqual(["bravo", "charlie", "alpha"]);
  });

  test("ties break alphabetically, never by the order Slack happened to send", () => {
    // Vendor order is undocumented. Depending on it lets the picker reshuffle itself
    // between two requests a second apart, which reads as a broken screen.
    return expect(
      namesFrom(listing([channel("charlie"), channel("alpha"), channel("bravo")])),
    ).resolves.toEqual(["alpha", "bravo", "charlie"]);
  });

  test("NO NAME IS SPECIAL — the ordering is not a keyword classifier", () => {
    // THE ROW THAT KILLS THE TEMPTING VERSION of this function. Ranking `#growth` above
    // `#random` is a classifier over a company's private vocabulary: it puts a dead
    // channel above the busy one whenever somebody's naming does not match ours, and it
    // ranks `#wachstum` last (D10). The founder knows which channel they want.
    return expect(
      namesFrom(listing([channel("random"), channel("growth"), channel("wachstum")])),
    ).resolves.toEqual(["growth", "random", "wachstum"]);
  });

  test("an archived channel is offered to nobody, whatever Slack sent", () => {
    // Slack was asked to exclude these. Checked again because that is the vendor's
    // promise rather than ours, and an archived channel is a destination that refuses
    // every post the founder will ever send to it.
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
    // The caller owns the sentence. An empty list must never be rendered as "your
    // workspace has no channels" when the real situation is a missing connection — but
    // a genuinely empty answer is still an answer.
    return expect(listChannels(BOT_TOKEN, { fetch: listing([]) })).resolves.toEqual({
      ok: true,
      channels: [],
    });
  });
});

describe("listChannels — two refusals, two next actions", () => {
  test("a scope the install never asked for says RECONNECT", async () => {
    // The realistic failure: a workspace connected by pasting a bot token from an app
    // whose scopes somebody picked by hand. Retrying achieves nothing.
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
    // D10, stated as a row. Telling a founder to reconnect on the strength of a code we
    // could not classify sends them to fix something we have no evidence is broken;
    // asking them to try again costs one click and is honest about every unknown.
    const result = await listChannels(BOT_TOKEN, {
      fetch: answering({ ok: false, error: "some_error_slack_added_last_tuesday" }),
    });

    expect(result).toEqual({ ok: false, code: "call_failed" });
  });

  test("a transport fault is a named refusal, never a throw", async () => {
    // A verifier that throws turns a refusal into a 500, and a 500 is where retry logic
    // and error pages start making decisions nobody designed (D8).
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
