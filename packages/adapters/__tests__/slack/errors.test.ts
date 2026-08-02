// The Slack failure mapping. The sibling of `../posthog/errors.test.ts`, holding the
// same line for the other adapter.
//
// The load-bearing test in this file is the redaction one. The port
// (`packages/shared/src/delivery/poster.ts`) hands this adapter an inherited obligation
// in words. Slack's own error text must never reach `PostResult.message` verbatim,
// because it can carry channel ids, team ids and request-identifying detail, and
// `z.string` accepts all of it silently. The schema cannot enforce that. These tests
// do.
import { describe, expect, test } from "bun:test";

import {
  FORBIDDEN_PRODUCT_JARGON,
  isRetryablePostFailure,
  POST_FAILURE_MESSAGES,
  postFailureCodeSchema,
} from "@growthmind/shared";
import type { PostFailureCode } from "@growthmind/shared";

import {
  mapSlackError,
  postFailure,
  SLACK_ERRORS_CALL_FAILED,
  SLACK_ERRORS_CHANNEL_UNAVAILABLE,
  SLACK_ERRORS_NOT_AUTHORISED,
  SLACK_ERRORS_REJECTED,
  UNCLASSIFIED_SLACK_ERROR_CODE,
} from "../../src/slack/errors";

/**
 * A Slack `{ok:false}` body as hostile as one can plausibly be: the error string, the
 * human-readable detail, the scope hints and the metadata all carry ids that identify a
 * workspace, a channel, a bot user and a request. None of it may survive into a
 * message.
 */
const AD_IDENTIFYING_FRAGMENTS: readonly string[] = [
  "C0ADFAKECHANNEL",
  "T0ADFAKETEAM",
  "U0ADFAKEBOTUSER",
  "ad-fake-request-8f21c",
  "channels:write",
  "chat:write",
];

describe("mapSlackError", () => {
  test("every documented Slack auth error maps to not_authorised, which is never retried", () => {
    expect(SLACK_ERRORS_NOT_AUTHORISED.length).toBeGreaterThan(0);

    for (const slackError of SLACK_ERRORS_NOT_AUTHORISED) {
      const code = mapSlackError(slackError);
      expect(code).toBe("not_authorised");
      // A revoked token answers every retry identically. Retrying it forever is how the
      // one problem a customer could act on stays hidden.
      expect(isRetryablePostFailure(code)).toBe(false);
    }
  });

  test("a channel that is gone, archived, or never joined maps to channel_unavailable, distinctly from an auth failure", () => {
    for (const slackError of SLACK_ERRORS_CHANNEL_UNAVAILABLE) {
      const code = mapSlackError(slackError);
      expect(code).toBe("channel_unavailable");
      expect(isRetryablePostFailure(code)).toBe(false);
    }

    // The two terminal codes must stay apart. They describe different things that
    // happened — a channel we cannot post into, versus credentials that are refused —
    // and each surface composes a different repair onto them ("invite the bot back in"
    // versus "reconnect Slack"). A customer sent to the wrong one does work that
    // changes nothing and then opens a support ticket.
    expect(mapSlackError("channel_not_found")).not.toBe(mapSlackError("invalid_auth"));
    expect(POST_FAILURE_MESSAGES.channel_unavailable).not.toBe(
      POST_FAILURE_MESSAGES.not_authorised,
    );
  });

  test("a payload Slack refuses maps to rejected, which retrying unchanged cannot fix", () => {
    for (const slackError of SLACK_ERRORS_REJECTED) {
      const code = mapSlackError(slackError);
      expect(code).toBe("rejected");
      expect(isRetryablePostFailure(code)).toBe(false);
    }

    // The two shapes the renderer can actually produce.
    expect(mapSlackError("invalid_blocks")).toBe("rejected");
    expect(mapSlackError("msg_too_long")).toBe("rejected");
  });

  test("throttling and Slack's own faults map to the one retryable code", () => {
    for (const slackError of SLACK_ERRORS_CALL_FAILED) {
      const code = mapSlackError(slackError);
      expect(code).toBe("call_failed");
      expect(isRetryablePostFailure(code)).toBe(true);
    }

    // Slack spells its rate-limit error without the underscore; both spellings are
    // carried because a wrong guess here is a silent no-op, not an error.
    expect(mapSlackError("ratelimited")).toBe("call_failed");
  });

  test("an unclassified Slack error code takes the retryable default rather than stranding the finding", () => {
    // The fail direction, chosen deliberately. A code we cannot classify must not land
    // on a terminal arm: that would drop a finding a second attempt would have
    // delivered, and would tell the customer to go and fix something we have no
    // evidence is broken.
    expect(UNCLASSIFIED_SLACK_ERROR_CODE).toBe("call_failed");
    expect(isRetryablePostFailure(UNCLASSIFIED_SLACK_ERROR_CODE)).toBe(true);

    for (const unknown of [
      "some_future_slack_error",
      "ekm_access_denied",
      "",
      "CHANNEL_NOT_FOUND",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(mapSlackError(unknown)).toBe(UNCLASSIFIED_SLACK_ERROR_CODE);
    }

    // A `{ok:false}` body carrying no `error` at all is a real shape (a proxy's
    // rewrite, a truncated body) and lands somewhere named rather than crashing the
    // caller.
    expect(mapSlackError(undefined)).toBe(UNCLASSIFIED_SLACK_ERROR_CODE);
  });

  test("no Slack error code appears in two groups", () => {
    // A code in two groups would silently take whichever branch runs first, and the
    // second group's comment would be a lie nobody could see.
    const all: readonly string[] = [
      ...SLACK_ERRORS_NOT_AUTHORISED,
      ...SLACK_ERRORS_CHANNEL_UNAVAILABLE,
      ...SLACK_ERRORS_REJECTED,
      ...SLACK_ERRORS_CALL_FAILED,
    ];
    expect([...all].toSorted()).toEqual([...new Set(all)].toSorted());
  });

  test("Slack's own text never reaches a returned message, however much identifying detail the error code carries", () => {
    // Every one of these is a Slack `error` string stuffed with the detail a real one
    // can carry. The mapper reads them; nothing they contain may come back out.
    const hostileCodes: readonly string[] = [
      "channel_not_found: C0ADFAKECHANNEL in T0ADFAKETEAM",
      "invalid_auth (bot U0ADFAKEBOTUSER, request ad-fake-request-8f21c)",
      "missing_scope needed=channels:write provided=chat:write",
    ];

    const fixedSentences: readonly string[] = Object.values(POST_FAILURE_MESSAGES);

    for (const hostile of hostileCodes) {
      const result = postFailure(mapSlackError(hostile));

      // The strongest form of the assertion: the message is not merely free of the
      // detail, it is one of exactly four hand-written sentences. There is no
      // expression in the adapter by which Slack's bytes could reach it.
      expect(fixedSentences).toContain(result.message);

      for (const fragment of AD_IDENTIFYING_FRAGMENTS) {
        expect(result.message).not.toContain(fragment);
      }
      expect(result.message).not.toContain(hostile);
    }
  });
});

describe("POST_FAILURE_MESSAGES", () => {
  test("every failure code has exactly one plain-English sentence and no two codes say the same thing", () => {
    const codes: readonly PostFailureCode[] = postFailureCodeSchema.options;

    for (const code of codes) {
      const message = POST_FAILURE_MESSAGES[code];
      expect(message.length).toBeGreaterThan(0);
      expect(postFailure(code)).toEqual({ ok: false, code, message });
    }

    // Four codes exist so four different things get done about them. Two identical
    // sentences would throw that distinction away at the last step.
    const messages = codes.map((code) => POST_FAILURE_MESSAGES[code]);
    expect(new Set(messages).size).toBe(codes.length);
  });

  test("no failure sentence uses product jargon, a bare status number, or re-labels a session as a person", () => {
    for (const message of Object.values(POST_FAILURE_MESSAGES)) {
      // One vocabulary, imported rather than restated. The rule
      // `packages/shared/src/delivery/messages.ts` states for the lane.
      for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
        expect(message.toLowerCase()).not.toContain(jargon);
      }
      // A bare three-digit status is jargon too (the bar `../posthog/errors.test.ts`
      // holds).
      expect(message).not.toMatch(/\b\d{3}\b/);
      // Identity stitching does not exist in this product, so nothing here may quietly
      // speak about people.
      expect(message.toLowerCase()).not.toMatch(/\b(users?|people|persons?|visitors?)\b/);
      // Vendor error jargon, which is what this whole file exists to keep out.
      expect(message).not.toContain("_");
    }
  });

  test("every sentence says the finding itself is untouched, because a delivery failure is a fact about Slack", () => {
    // A sentence keyed by a failure alone may assert only what that failure
    // establishes. None of these knows anything about what we found.
    for (const message of Object.values(POST_FAILURE_MESSAGES)) {
      expect(message).toContain("Nothing about what we found has changed");
    }
  });
});
