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

      expect(isRetryablePostFailure(code)).toBe(false);
    }
  });

  test("a channel that is gone, archived, or never joined maps to channel_unavailable, distinctly from an auth failure", () => {
    for (const slackError of SLACK_ERRORS_CHANNEL_UNAVAILABLE) {
      const code = mapSlackError(slackError);
      expect(code).toBe("channel_unavailable");
      expect(isRetryablePostFailure(code)).toBe(false);
    }

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

    expect(mapSlackError("invalid_blocks")).toBe("rejected");
    expect(mapSlackError("msg_too_long")).toBe("rejected");
  });

  test("throttling and Slack's own faults map to the one retryable code", () => {
    for (const slackError of SLACK_ERRORS_CALL_FAILED) {
      const code = mapSlackError(slackError);
      expect(code).toBe("call_failed");
      expect(isRetryablePostFailure(code)).toBe(true);
    }

    expect(mapSlackError("ratelimited")).toBe("call_failed");
  });

  test("an unclassified Slack error code takes the retryable default rather than stranding the finding", () => {
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

    expect(mapSlackError(undefined)).toBe(UNCLASSIFIED_SLACK_ERROR_CODE);
  });

  test("no Slack error code appears in two groups", () => {
    const all: readonly string[] = [
      ...SLACK_ERRORS_NOT_AUTHORISED,
      ...SLACK_ERRORS_CHANNEL_UNAVAILABLE,
      ...SLACK_ERRORS_REJECTED,
      ...SLACK_ERRORS_CALL_FAILED,
    ];
    expect([...all].toSorted()).toEqual([...new Set(all)].toSorted());
  });

  test("Slack's own text never reaches a returned message, however much identifying detail the error code carries", () => {
    const hostileCodes: readonly string[] = [
      "channel_not_found: C0ADFAKECHANNEL in T0ADFAKETEAM",
      "invalid_auth (bot U0ADFAKEBOTUSER, request ad-fake-request-8f21c)",
      "missing_scope needed=channels:write provided=chat:write",
    ];

    const fixedSentences: readonly string[] = Object.values(POST_FAILURE_MESSAGES);

    for (const hostile of hostileCodes) {
      const result = postFailure(mapSlackError(hostile));

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

    const messages = codes.map((code) => POST_FAILURE_MESSAGES[code]);
    expect(new Set(messages).size).toBe(codes.length);
  });

  test("no failure sentence uses product jargon, a bare status number, or re-labels a session as a person", () => {
    for (const message of Object.values(POST_FAILURE_MESSAGES)) {
      for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
        expect(message.toLowerCase()).not.toContain(jargon);
      }

      expect(message).not.toMatch(/\b\d{3}\b/);

      expect(message.toLowerCase()).not.toMatch(/\b(users?|people|persons?|visitors?)\b/);

      expect(message).not.toContain("_");
    }
  });

  test("every sentence says the finding itself is untouched, because a delivery failure is a fact about Slack", () => {
    for (const message of Object.values(POST_FAILURE_MESSAGES)) {
      expect(message).toContain("Nothing about what we found has changed");
    }
  });
});
