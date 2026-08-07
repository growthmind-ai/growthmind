import { NOTIFICATION_QUIET_REASONS, NOTIFICATION_SEND_FAILURE_REASONS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { reviewFindingText, type FindingText } from "../../src/delivery/finding-text";
import {
  agentFirstContactSentence,
  findingDeliveredSentence,
  genericNotificationSentence,
  keysRevokedSentence,
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
