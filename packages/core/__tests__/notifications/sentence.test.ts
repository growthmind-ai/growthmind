import { NOTIFICATION_QUIET_REASONS, NOTIFICATION_SEND_FAILURE_REASONS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { reviewFindingText, type FindingText } from "../../src/delivery/finding-text";
import {
  agentFirstContactSentence,
  analysisFailingSentence,
  backfillCompleteSentence,
  findingDeliveredSentence,
  genericNotificationSentence,
  keyCreatedSentence,
  keysRevokedSentence,
  slackDisconnectedSentence,
} from "../../src/notifications/sentence";

// One sentence per type, rendered identically in the bell and in Slack. The revoke copy
// below is pinned VERBATIM from apps/web/lib/first-run/agent-revoke-announcement.ts —
// the bespoke module this sprint retires — so the migration is a move, not a rewrite.

const WORKSPACE_NAME = "Fixture workspace";

const REVOKED_BY_NAME = "Priya";

// buildAgentRevokeAnnouncement's UNKNOWN_REVOKER, byte for byte.
const UNKNOWN_REVOKER = "Someone in this workspace";

const REVOKE_TAIL =
  "Anything that was calling us with one of those keys has stopped — reconnect it with a new key when you're ready.";

// PRD FR-4's draft, PROPOSED pending Tom's sign-off; the swap is one string here and one
// in the builder.
const FIRST_CONTACT_DRAFT = "A coding assistant connected to this workspace for the first time.";

function cleanFindingText(): Extract<FindingText, { held: false }> {
  const verdict = reviewFindingText({
    headline: "Sign-up stalled at the pricing page.",
    context: ["Two of eleven visits ended without going onward."],
  });

  if (verdict.held) {
    throw new Error("fixture error: the clean finding text was held by the scanner");
  }

  return verdict;
}

function heldFindingText(): FindingText {
  const verdict = reviewFindingText({
    headline: "Ask jane.doe@acme.example why checkout stalled.",
    context: [],
  });

  if (!verdict.held) {
    throw new Error("fixture error: the residual-pii offender was not held by the scanner");
  }

  return verdict;
}

describe("the keys_revoked sentence migrates verbatim", () => {
  test("a resolved actor renders the announcement the revoke route ships today", () => {
    const sentence = keysRevokedSentence({
      workspaceName: WORKSPACE_NAME,
      revokedByName: REVOKED_BY_NAME,
    });

    expect(sentence).toBe(
      `${REVOKED_BY_NAME} revoked every key for ${WORKSPACE_NAME}. ${REVOKE_TAIL}`,
    );
  });

  test("an unresolved actor falls back to the unknown-revoker phrase, not a blank", () => {
    const sentence = keysRevokedSentence({
      workspaceName: WORKSPACE_NAME,
      revokedByName: null,
    });

    expect(sentence).toBe(
      `${UNKNOWN_REVOKER} revoked every key for ${WORKSPACE_NAME}. ${REVOKE_TAIL}`,
    );
  });
});

describe("the finding_delivered sentence is the finding's own scanned text", () => {
  test("a clean branded text passes through unaltered", () => {
    const clean = cleanFindingText();

    expect(findingDeliveredSentence(clean)).toBe(clean.headline);
  });

  test("a held text renders the generic sentence — never a second unscanned reader path", () => {
    expect(findingDeliveredSentence(heldFindingText())).toBe(genericNotificationSentence());
  });
});

describe("the agent_first_contact sentence", () => {
  test("matches the PROPOSED draft", () => {
    expect(agentFirstContactSentence()).toBe(FIRST_CONTACT_DRAFT);
  });
});

describe("the generic fallback is a customer sentence, not a diagnostic", () => {
  test("names no internal reason code and no jargon", () => {
    const sentence = genericNotificationSentence();

    expect(sentence.trim().length).toBeGreaterThan(0);

    const internalCodes: readonly string[] = [
      ...NOTIFICATION_SEND_FAILURE_REASONS,
      ...NOTIFICATION_QUIET_REASONS,
    ];
    for (const code of internalCodes) {
      expect(sentence).not.toContain(code);
    }

    // A snake_case token in customer copy is an internal identifier by construction.
    expect(/\b[a-z]+_[a-z_]+\b/.test(sentence)).toBe(false);

    for (const token of ["payload", "schema", "null", "undefined", "enum"]) {
      expect(new RegExp(`\\b${token}\\b`, "i").test(sentence)).toBe(false);
    }
  });
});

// The O-051 job-2 builders (ADD checklist unit row 15). The shared bar: plain English, no
// stored code, no snake_case identifier, and every count beside the noun it counts.
function expectPlainEnglish(sentence: string): void {
  expect(sentence.trim().length).toBeGreaterThan(0);

  expect(/\b[a-z]+_[a-z_]+\b/.test(sentence)).toBe(false);

  for (const token of ["payload", "schema", "null", "undefined", "enum", "dispatch", "lease"]) {
    expect(new RegExp(`\\b${token}\\b`, "i").test(sentence)).toBe(false);
  }
}

describe("the key_created sentence reuses the revoke builder's unknown-actor fallback", () => {
  test("a resolved actor is named", () => {
    const sentence = keyCreatedSentence({ createdByName: "Priya" });

    expect(sentence).toContain("Priya");
    expectPlainEnglish(sentence);
  });

  test("a key minted from the CLI falls back to the shared unknown-actor phrase, not a blank", () => {
    // One home for the phrase: the revoke builder's UNKNOWN_REVOKER, reused, never copied.
    const sentence = keyCreatedSentence({ createdByName: null });

    expect(sentence).toContain(UNKNOWN_REVOKER);
    expectPlainEnglish(sentence);
  });
});

describe("the slack_disconnected sentence names no vendor text", () => {
  test("the stored code never reaches the sentence", () => {
    const sentence = slackDisconnectedSentence("not_authorised");

    expect(sentence).not.toContain("not_authorised");
    expectPlainEnglish(sentence);
  });

  test("a null code still renders a customer sentence", () => {
    const sentence = slackDisconnectedSentence(null);

    expectPlainEnglish(sentence);
  });
});

describe("the backfill_complete sentence names what its count is of", () => {
  test("the frozen count appears beside its noun, never bare", () => {
    const sentence = backfillCompleteSentence({ sessionsTouched: 128, eventsPersisted: 5321 });

    expect(sentence).toContain("128");
    expect(/session/i.test(sentence)).toBe(true);
    expectPlainEnglish(sentence);
  });
});

describe("the analysis_failing sentence carries its denominator", () => {
  test("three of the last three, and the project by name", () => {
    const sentence = analysisFailingSentence({ failed: 3, of: 3, projectName: "Checkout" });

    expect(sentence).toContain("3 of the last 3");
    expect(sentence).toContain("Checkout");
    expectPlainEnglish(sentence);
  });
});
